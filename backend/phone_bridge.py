"""Bidirectional GA Realtime/Twilio audio with playback-aware interruption handling."""
import asyncio
import base64
from dataclasses import dataclass
import json
import logging
import time
from urllib.parse import urlencode
from uuid import uuid4

from backend.agent import memory_instructions
from backend.ai import realtime_config
from backend.db import dumps, now_iso
from backend.tools.schemas import realtime_tools

logger = logging.getLogger(__name__)


@dataclass
class Playback:
    start_ms: float
    response_id: str = ""
    total_ms: float = 0
    acked_ms: float = 0
    content_index: int = 0
    interrupted_ms: int | None = None


class PhoneBridge:
    def __init__(self, telephony, twilio_ws, call, stream_sid):
        self.telephony, self.twilio, self.call, self.stream_sid = telephony, twilio_ws, call, stream_sid
        self.db, self.tools = telephony.db, telephony.tools
        self.phone, self.call_sid = call["phone"], call["call_sid"]
        self.stop = asyncio.Event()
        self.end_reason = "hangup"
        self.realtime = None
        self.send_lock = asyncio.Lock()
        self.tool_queue = asyncio.Queue()
        self.seen_calls = set()
        self.tool_steps = 0
        self.active_response = None
        self.response_requested = False
        self.pending_response = False
        self.speaking = False
        self.speech_ended_at = None
        self.response_metrics = {}
        self.interrupted_responses = set()
        self.stream_timestamp = 0
        self.playback_tail = 0
        self.playback: dict[str, Playback] = {}
        self.marks: dict[str, tuple[str, float]] = {}
        self.entries: dict[str, dict] = {}
        self.callback_end_requested = False
        self.callback_goodbye_response = None
        self.callback_goodbye_done = False

    async def send(self, event):
        async with self.send_lock:
            await self.realtime.send(dumps(event))

    async def request_response(self):
        if self.speaking or self.active_response or self.response_requested:
            self.pending_response = True
            return
        self.pending_response = False
        self.response_requested = True
        event = {"type": "response.create"}
        if self.tool_steps >= 6:
            event["response"] = {"tool_choice": "none"}
        await self.send(event)

    async def run(self):
        settings = self.telephony.settings
        prompt = memory_instructions(self.telephony.pack.voice_prompt, self.db.history(self.phone))
        prompt += ("\n\nTransport: this is a real telephone call, channel phone. The shared prompt's browser-demo "
                   "callback description applies to browser calls only. Follow these transport instructions for this call. "
                   "Greet the customer briefly. "
                   "Tool phone arguments must use the bound customer memory phone. Photos and payment links "
                   "go to this customer's WhatsApp-style browser panel. A successful schedule_callback will dial "
                   "their actual telephone number after this call ends. Never claim a live human line transfer.")
        url = "wss://api.openai.com/v1/realtime?" + urlencode({"model": settings.realtime_model})
        tasks = []
        # The timer signals the main bridge; one coroutine owns socket closure.
        deadline_task = asyncio.create_task(self.enforce_deadline())
        try:
            async with self.telephony.connector(
                url, additional_headers={"Authorization": "Bearer " + settings.api_key},
                open_timeout=10, close_timeout=2, max_size=1024 * 1024, max_queue=32) as realtime:
                self.realtime = realtime
                await self.send({"type": "session.update", "session": realtime_config(settings, prompt, realtime_tools(), phone=True)})
                async with asyncio.timeout(10):
                    while True:
                        event = json.loads(await realtime.recv())
                        if event["type"] == "session.updated":
                            break
                        if event["type"] == "error":
                            raise RuntimeError("Realtime session configuration failed")
                await self.request_response()
                tasks = [asyncio.create_task(self.receive_twilio()), asyncio.create_task(self.receive_realtime()),
                         asyncio.create_task(self.execute_tools()), asyncio.create_task(self.watch_inbox()),
                         asyncio.create_task(self.stop.wait())]
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
                if self.end_reason in ("time_limit", "callback_requested"):
                    # Resume TwiML Hangup before spending time closing the upstream WS.
                    await self.twilio.close()
        finally:
            deadline_task.cancel()
            for task in tasks:
                task.cancel()
            await asyncio.gather(deadline_task, *tasks, return_exceptions=True)
            # response.done normally logs metrics, but a hangup can arrive first.
            for response_id in list(self.response_metrics):
                self.log_turn(response_id, "hangup")

    async def enforce_deadline(self):
        await asyncio.sleep(max(0, self.call["deadline"] - time.time()))
        self.end_reason = "time_limit"
        self.stop.set()

    async def receive_twilio(self):
        while True:
            event = await self.twilio.receive_json()
            kind = event.get("event")
            if event.get("streamSid") not in (None, self.stream_sid):
                raise ValueError("Media belongs to a different stream")
            if kind == "media":
                media = event["media"]
                if media.get("track", "inbound") != "inbound":
                    continue
                payload = media["payload"]
                if not isinstance(payload, str) or len(payload) > 128000:
                    raise ValueError("Invalid audio frame")
                base64.b64decode(payload, validate=True)
                self.stream_timestamp = max(self.stream_timestamp, int(media["timestamp"]))
                await self.send({"type": "input_audio_buffer.append", "audio": payload})
            elif kind == "mark":
                mark = self.marks.pop(event["mark"]["name"], None)
                if mark:
                    item_id, end_ms = mark
                    self.playback[item_id].acked_ms = max(self.playback[item_id].acked_ms, end_ms)
                    self.maybe_end_callback()
            elif kind == "stop":
                self.end_reason = "hangup"
                return
            elif kind == "start":
                raise ValueError("A stream may only start once")

    async def receive_realtime(self):
        async for raw in self.realtime:
            event = json.loads(raw)
            kind = event["type"]
            if kind == "response.created":
                response_id = event["response"]["id"]
                self.active_response, self.response_requested = response_id, False
                self.response_metrics[response_id] = {"started": time.perf_counter(), "first_audio_ms": None,
                                                     "speech_ended": self.speech_ended_at}
                if self.callback_end_requested:
                    self.callback_goodbye_response = response_id
                    self.callback_goodbye_done = False
            elif kind == "response.output_audio.delta":
                await self.output_audio(event)
            elif kind == "input_audio_buffer.speech_started":
                self.speaking, self.tool_steps = True, 0
                # VAD interrupt_response automatically cancels the model response.
                if self.active_response:
                    self.interrupted_responses.add(self.active_response)
                await self.interrupt()
            elif kind == "input_audio_buffer.speech_stopped":
                self.speaking = False
                self.speech_ended_at = time.perf_counter()
                # create_response in the shared VAD config starts the next response.
                self.response_requested = True
            elif kind in ("conversation.item.added", "conversation.item.created"):
                item = event["item"]
                if item.get("type") == "message" and item.get("role") in ("user", "assistant"):
                    self.entries.setdefault(item["id"], {"role": item["role"], "text": ""})
            elif kind == "conversation.item.input_audio_transcription.completed":
                self.entries.setdefault(event["item_id"], {"role": "user", "text": ""})["text"] = event["transcript"][:10000]
            elif kind == "response.output_audio_transcript.delta":
                entry = self.entries.setdefault(event["item_id"], {"role": "assistant", "text": ""})
                entry["text"] = (entry["text"] + event["delta"])[:10000]
            elif kind == "response.output_audio_transcript.done":
                self.entries.setdefault(event["item_id"], {"role": "assistant", "text": ""})["text"] = event["transcript"][:10000]
            elif kind == "response.done":
                response = event["response"]
                response_id, status = response["id"], response["status"]
                self.log_turn(response_id, status)
                if self.active_response == response_id:
                    self.active_response = None
                self.response_requested = False
                if status == "failed":
                    raise RuntimeError("Realtime response failed")
                calls = [item for item in response.get("output", []) if item.get("type") == "function_call"
                         and item.get("call_id") not in self.seen_calls] if status == "completed" else []
                if calls:
                    self.seen_calls.update(item["call_id"] for item in calls)
                    await self.tool_queue.put(calls)
                elif self.pending_response and not self.speaking:
                    await self.request_response()
                if response_id == self.callback_goodbye_response and status == "completed" and not calls:
                    self.callback_goodbye_done = True
                    self.maybe_end_callback()
            elif kind == "error":
                code = event.get("error", {}).get("code")
                if code == "conversation_already_has_active_response":
                    self.pending_response = True
                else:
                    raise RuntimeError("Realtime stream returned an error")
        raise RuntimeError("Realtime connection closed before hangup")

    async def output_audio(self, event):
        if event.get("response_id") in self.interrupted_responses:
            return
        item_id = event["item_id"]
        audio = event["delta"]
        duration_ms = len(base64.b64decode(audio, validate=True)) / 8  # 8000 mu-law bytes per second
        playback = self.playback.get(item_id)
        if playback is None:
            playback = self.playback[item_id] = Playback(max(self.stream_timestamp, self.playback_tail),
                                                       response_id=event.get("response_id", ""),
                                                       content_index=event.get("content_index", 0))
        if playback.interrupted_ms is not None:
            return
        playback.total_ms += duration_ms
        self.playback_tail = max(self.stream_timestamp, self.playback_tail) + duration_ms
        metric = self.response_metrics.get(event.get("response_id"))
        if metric and metric["first_audio_ms"] is None and metric["speech_ended"] is not None:
            metric["first_audio_ms"] = (time.perf_counter() - metric["speech_ended"]) * 1000
        await self.twilio.send_json({"event": "media", "streamSid": self.stream_sid, "media": {"payload": audio}})
        mark_name = uuid4().hex
        self.marks[mark_name] = (item_id, playback.total_ms)
        await self.twilio.send_json({"event": "mark", "streamSid": self.stream_sid, "mark": {"name": mark_name}})

    async def interrupt(self):
        await self.twilio.send_json({"event": "clear", "streamSid": self.stream_sid})
        for item_id, playback in self.playback.items():
            if playback.interrupted_ms is not None or playback.acked_ms >= playback.total_ms:
                continue
            heard = int(min(playback.total_ms, max(playback.acked_ms, self.stream_timestamp - playback.start_ms, 0)))
            playback.interrupted_ms = heard
            await self.send({"type": "conversation.item.truncate", "item_id": item_id,
                             "content_index": playback.content_index, "audio_end_ms": heard})
        # ACKs generated by clear are for discarded audio; they must not advance playback.
        self.marks.clear()
        self.playback_tail = self.stream_timestamp

    async def execute_tools(self):
        while True:
            calls = await self.tool_queue.get()
            for item in calls:
                if self.tool_steps >= 6:
                    result = {"error": "tool_step_limit", "message": "Ask the customer for the next detail before using more tools."}
                else:
                    self.tool_steps += 1
                    try:
                        args = json.loads(item["arguments"])
                        if not isinstance(args, dict):
                            raise ValueError("Tool arguments must be an object")
                    except (ValueError, TypeError):
                        args = {"_invalid_arguments": str(item.get("arguments"))[:1000]}
                    result = await self.tools.execute(item["name"], self.phone, "phone", args)
                    if item["name"] == "schedule_callback" and result.get("scheduled"):
                        self.callback_end_requested = True
                    self.entries["tool:" + item["call_id"]] = {"role": "tool", "text": item["name"] + ": " + dumps(result)[:6000]}
                await self.send({"type": "conversation.item.create", "item": {
                    "type": "function_call_output", "call_id": item["call_id"], "output": dumps(result)}})
            await self.request_response()

    def maybe_end_callback(self):
        if not self.callback_goodbye_done or self.speaking:
            return
        audio = [p for p in self.playback.values() if p.response_id == self.callback_goodbye_response]
        if audio and all(p.acked_ms >= p.total_ms and p.interrupted_ms is None for p in audio):
            self.end_reason = "callback_requested"
            self.stop.set()

    async def watch_inbox(self):
        cursor = now_iso()
        while True:
            await asyncio.sleep(1)
            inbox = self.db.inbox(self.phone, cursor)
            messages, events = inbox["messages"], inbox["events"]
            cursor = max([cursor] + [item["ts"] for item in messages + events])
            media_ids = [m["data"]["media_id"] for m in messages if m["from"] == "customer" and m["type"] == "image"]
            if media_ids:
                await self.send({"type": "conversation.item.create", "item": {"type": "message", "role": "user",
                    "content": [{"type": "input_text", "text": "I uploaded these photos in the customer panel: " + dumps(media_ids)}]}})
                await self.request_response()

    def log_turn(self, response_id, status):
        metric = self.response_metrics.pop(response_id, None)
        if metric is None:
            return
        elapsed = round((time.perf_counter() - metric["started"]) * 1000, 3)
        first = round(metric["first_audio_ms"], 3) if metric["first_audio_ms"] is not None else None
        with self.db.connection(write=True) as conn:
            conn.execute("INSERT INTO phone_turns VALUES (?,?,?,?,?,?,?,?)",
                         (uuid4().hex, self.call_sid, self.phone, now_iso(), response_id, first, elapsed, status))
        self.db.log_tool(self.phone, "phone", "realtime_turn", {"call_sid": self.call_sid, "response_id": response_id},
                         {"speech_to_first_audio_ms": first, "response_ms": elapsed, "status": status}, elapsed)
        logger.info("Phone turn %s: first audio=%s ms, response=%s ms, status=%s", response_id, first, elapsed, status)

    def transcript_text(self):
        lines = []
        for item_id, entry in self.entries.items():
            text, role = entry["text"], entry["role"]
            if not text:
                continue
            playback = self.playback.get(item_id)
            if role == "assistant" and playback:
                if playback.interrupted_ms is not None:
                    text = f"[Audio interrupted at {playback.interrupted_ms} ms; generated text omitted because partial playback cannot be aligned.]"
                elif playback.acked_ms < playback.total_ms:
                    text = "[Audio playback not fully acknowledged before hangup; generated text omitted.]"
            lines.append({"user": "Customer", "assistant": "FlowQ", "tool": "Verified backend tool"}[role] + ": " + text)
        return "\n".join(lines)[:100000]
