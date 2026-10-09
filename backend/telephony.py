"""Authenticated Twilio entry points, a SQLite call lease, and durable callbacks."""
import asyncio
from contextlib import suppress
from datetime import datetime, timezone
import hmac
import logging
import re
import secrets
import time
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from twilio.http.async_http_client import AsyncTwilioHttpClient
from twilio.request_validator import RequestValidator
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse
from websockets.asyncio.client import connect

from backend.db import normalize_phone
from backend.phone_bridge import PhoneBridge

logger = logging.getLogger(__name__)
MAX_CALL_SECONDS = 300
START_TIMEOUT_SECONDS = 15
SID = re.compile(r"CA[0-9a-fA-F]{32}")
TERMINAL_STATUSES = {"completed", "busy", "failed", "no-answer", "canceled"}


class TwilioGateway:
    def __init__(self, settings):
        self.http = AsyncTwilioHttpClient(timeout=10, max_retries=0)
        self.client = Client(settings.twilio_account_sid, settings.twilio_auth_token, http_client=self.http)
        self.settings = settings

    async def dial(self, caller, callback_id, base_url):
        return await self.client.calls.create_async(
            to=caller, from_=self.settings.twilio_phone_number,
            url=base_url + "/api/twilio/voice?" + urlencode({"callback_id": callback_id}), method="POST",
            status_callback=base_url + "/api/twilio/status", status_callback_method="POST",
            status_callback_event=["completed"], timeout=30, time_limit=MAX_CALL_SECONDS)

    async def complete(self, call_sid):
        await self.client.calls(call_sid).update_async(status="completed")

    async def close(self):
        await self.http.close()


class Telephony:
    def __init__(self, settings, db, pack, tools, agent, *, gateway=None, connector=None):
        self.settings, self.db, self.pack, self.tools, self.agent = settings, db, pack, tools, agent
        self.gateway = gateway
        self.connector = connector or connect
        self.worker = None
        self.bridges: dict[str, PhoneBridge] = {}
        self.summary_tasks: set[asyncio.Task] = set()
        self.tools.phone_callback = self.schedule_callback

    @property
    def base_url(self):
        value = self.settings.public_base_url.strip()
        if value and "://" not in value:
            value = "https://" + value
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise ValueError("PUBLIC_BASE_URL must be an HTTPS origin, for example https://demo.trycloudflare.com")
        return value.rstrip("/")

    @property
    def stream_url(self):
        return "wss://" + self.base_url.removeprefix("https://") + "/api/twilio/media"

    @property
    def configured(self):
        if not (self.settings.twilio_account_sid and self.settings.twilio_auth_token
                and self.settings.twilio_phone_number and self.settings.public_base_url):
            return False
        try:
            self.base_url
            normalize_phone(self.settings.twilio_phone_number)
            if self.settings.demo_caller_phone:
                normalize_phone(self.settings.demo_caller_phone)
                if sum(bool(c.get("telephony_demo_target")) for c in self.pack.customers) != 1:
                    return False
        except ValueError:
            return False
        return True

    async def start(self):
        if not self.configured or not self.settings.api_key:
            return
        self.gateway = self.gateway or TwilioGateway(self.settings)
        # A placement interrupted by a process crash has an unknown remote outcome.
        # Never redial it automatically: that could produce duplicate real calls.
        with self.db.connection(write=True) as conn:
            conn.execute("UPDATE phone_callbacks SET status='failed', error='Placement interrupted; check Twilio call logs' "
                         "WHERE status='placing'")
        self.worker = asyncio.create_task(self.callback_worker(), name="twilio-callbacks")

    async def close(self):
        if self.worker:
            self.worker.cancel()
            with suppress(asyncio.CancelledError):
                await self.worker
        for bridge in list(self.bridges.values()):
            bridge.stop.set()
        if self.summary_tasks:
            await asyncio.gather(*list(self.summary_tasks), return_exceptions=True)
        if self.gateway and hasattr(self.gateway, "close"):
            await self.gateway.close()

    def customer_phone(self, caller):
        caller = normalize_phone(caller)
        if self.settings.demo_caller_phone and caller == normalize_phone(self.settings.demo_caller_phone):
            target = next(c for c in self.pack.customers if c.get("telephony_demo_target"))
            return normalize_phone(target["phone"])
        return caller

    def validate_signature(self, url, params, signature):
        return bool(signature) and RequestValidator(self.settings.twilio_auth_token).validate(url, params, signature)

    async def signed_form(self, request: Request):
        if not self.configured:
            raise HTTPException(503, "Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and PUBLIC_BASE_URL")
        form = await request.form(max_files=0, max_fields=100)
        # Use the configured public origin, never the tunnel's internal Host/scheme.
        url = self.base_url + request.url.path
        if request.url.query:
            url += "?" + request.url.query
        if not self.validate_signature(url, form, request.headers.get("x-twilio-signature", "")):
            raise HTTPException(403, "Invalid Twilio signature")
        if form.get("AccountSid") != self.settings.twilio_account_sid:
            raise HTTPException(403, "Unexpected Twilio account")
        if not SID.fullmatch(str(form.get("CallSid", ""))):
            raise HTTPException(422, "Invalid CallSid")
        return form

    @staticmethod
    def unavailable(message):
        twiml = VoiceResponse()
        twiml.say(message, language="en-US")
        twiml.hangup()
        return Response(str(twiml), media_type="application/xml")

    def reserve(self, call_sid, caller, *, callback_id=None):
        """Single slot shared by webhook reservations, active streams and outbound dialing."""
        phone = self.customer_phone(caller)
        self.db.ensure_customer(phone)
        now = time.time()
        with self.db.connection(write=True) as conn:
            conn.execute("DELETE FROM phone_call_slot WHERE expires<=?", (now,))
            slot = conn.execute("SELECT * FROM phone_call_slot WHERE id=1").fetchone()
            existing = conn.execute("SELECT * FROM phone_calls WHERE call_sid=?", (call_sid,)).fetchone()
            if existing:
                return dict(existing) if (existing["phase"] == "reserved" and slot
                    and slot["call_sid"] == call_sid and existing["caller"] == caller) else None
            if callback_id:
                job = conn.execute("SELECT * FROM phone_callbacks WHERE id=?", (callback_id,)).fetchone()
                if (not job or job["caller"] != caller or job["status"] not in ("placing", "placed")
                        or job["call_sid"] not in (None, call_sid)
                        or not slot or slot["call_sid"] not in ("callback:" + callback_id, call_sid)):
                    return None
                conn.execute("UPDATE phone_callbacks SET call_sid=? WHERE id=?", (call_sid, callback_id))
            elif slot:
                return None
            token = secrets.token_urlsafe(32)
            conn.execute("INSERT INTO phone_calls (call_sid,phone,caller,token,phase,created_at,deadline) "
                         "VALUES (?,?,?,?,'reserved',?,?)",
                         (call_sid, phone, caller, token, now, now + MAX_CALL_SECONDS))
            conn.execute("INSERT OR REPLACE INTO phone_call_slot VALUES (1,?,?)", (call_sid, now + 30))
            return dict(conn.execute("SELECT * FROM phone_calls WHERE call_sid=?", (call_sid,)).fetchone())

    def activate(self, start):
        params = start.get("customParameters", {})
        if start.get("accountSid") != self.settings.twilio_account_sid:
            raise ValueError("Unexpected Twilio stream account")
        if start.get("mediaFormat") != {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1}:
            raise ValueError("Twilio stream must use mono mu-law at 8000 Hz")
        caller = normalize_phone(params.get("phone", ""))
        call_sid = start.get("callSid", "")
        if not SID.fullmatch(call_sid) or not re.fullmatch(r"MZ[0-9a-fA-F]{32}", start.get("streamSid", "")):
            raise ValueError("Invalid stream identity")
        now = time.time()
        with self.db.connection(write=True) as conn:
            row = conn.execute("SELECT * FROM phone_calls WHERE call_sid=?", (call_sid,)).fetchone()
            slot = conn.execute("SELECT * FROM phone_call_slot WHERE id=1").fetchone()
            if (not row or row["phase"] != "reserved" or row["caller"] != caller
                    or not hmac.compare_digest(row["token"], str(params.get("stream_token", "")))
                    or not slot or slot["call_sid"] != call_sid or slot["expires"] <= now or row["deadline"] <= now):
                raise ValueError("Stream is not bound to a valid, unused call reservation")
            conn.execute("UPDATE phone_calls SET phase='active' WHERE call_sid=?", (call_sid,))
            # Keep the slot through stream/REST cleanup at the five-minute boundary.
            conn.execute("UPDATE phone_call_slot SET expires=? WHERE id=1", (row["deadline"] + 15,))
            return dict(row)

    def schedule_callback(self, phone, delay_seconds):
        if not self.gateway:
            raise ValueError("Telephone callbacks are unavailable")
        with self.db.connection(write=True) as conn:
            call = conn.execute("SELECT * FROM phone_calls WHERE phone=? AND phase='active' AND deadline>? "
                                "ORDER BY created_at DESC LIMIT 1", (phone, time.time())).fetchone()
            if not call:
                raise ValueError("A telephone callback must be requested during an active phone call")
            job = conn.execute("SELECT * FROM phone_callbacks WHERE source_call_sid=?", (call["call_sid"],)).fetchone()
            if not job:
                job_id, due = "callback_" + uuid4().hex, time.time() + delay_seconds
                conn.execute("INSERT INTO phone_callbacks VALUES (?,?,?,?,?,'pending',NULL,NULL)",
                             (job_id, call["call_sid"], phone, call["caller"], due))
                job = conn.execute("SELECT * FROM phone_callbacks WHERE id=?", (job_id,)).fetchone()
        return {"scheduled": job["status"] in ("pending", "placing", "placed"), "callback_id": job["id"],
                "channel": "phone", "delay_seconds": delay_seconds,
                "scheduled_at": datetime.fromtimestamp(job["due_at"], timezone.utc).isoformat(),
                "message": "We will call your telephone number after the delay and after this call ends."}

    async def dispatch_callback(self):
        now = time.time()
        with self.db.connection(write=True) as conn:
            conn.execute("DELETE FROM phone_call_slot WHERE expires<=?", (now,))
            if conn.execute("SELECT 1 FROM phone_call_slot").fetchone():
                return
            job = conn.execute("SELECT * FROM phone_callbacks WHERE status='pending' AND due_at<=? "
                               "ORDER BY due_at LIMIT 1", (now,)).fetchone()
            if not job:
                return
            job = dict(job)
            conn.execute("UPDATE phone_callbacks SET status='placing' WHERE id=?", (job["id"],))
            conn.execute("INSERT INTO phone_call_slot VALUES (1,?,?)", ("callback:" + job["id"], now + 90))
        started = time.perf_counter()
        try:
            call = await self.gateway.dial(job["caller"], job["id"], self.base_url)
            with self.db.connection(write=True) as conn:
                # The answer webhook can arrive before the REST create response.
                conn.execute("UPDATE phone_callbacks SET status='placed',call_sid=COALESCE(call_sid,?) WHERE id=?",
                             (call.sid, job["id"]))
            result = {"placed": True, "callback_id": job["id"], "call_sid": call.sid}
        except asyncio.CancelledError:
            self.callback_failed(job["id"], "Placement interrupted; check Twilio call logs")
            raise
        except Exception:
            # Provider exceptions may contain credentials/URLs. Persist a safe failure only.
            logger.warning("Twilio callback placement failed")
            self.callback_failed(job["id"], "Twilio could not place the call; check credentials, permissions and verified numbers")
            result = {"placed": False, "callback_id": job["id"], "error": "twilio_call_failed"}
            self.db.add_message(job["phone"], "agent", "text", text="We could not place your callback. Please contact the shop or try again.")
        self.db.log_tool(job["phone"], "phone", "twilio_callback", {"callback_id": job["id"]}, result,
                         round((time.perf_counter() - started) * 1000, 3))

    def callback_failed(self, callback_id, reason):
        with self.db.connection(write=True) as conn:
            conn.execute("UPDATE phone_callbacks SET status='failed',error=? WHERE id=?", (reason, callback_id))
            conn.execute("DELETE FROM phone_call_slot WHERE call_sid=?", ("callback:" + callback_id,))

    async def callback_worker(self):
        while True:
            try:
                await self.dispatch_callback()
            except Exception:
                logger.warning("Twilio callback worker unavailable")
            await asyncio.sleep(0.5)

    async def complete_remote(self, call_sid):
        if self.gateway:
            try:
                await self.gateway.complete(call_sid)
            except Exception:
                logger.warning("Twilio call completion failed; closing the stream resumes TwiML Hangup")

    def finish(self, call_sid, reason, transcript=""):
        with self.db.connection(write=True) as conn:
            conn.execute("UPDATE phone_calls SET phase='ended',end_reason=?,transcript=? WHERE call_sid=?",
                         (reason, transcript, call_sid))
            conn.execute("DELETE FROM phone_call_slot WHERE call_sid=?", (call_sid,))

    def queue_summary(self, phone, transcript):
        task = asyncio.create_task(self.agent.end_call(phone, transcript, channel="phone"), name="phone-summary")
        self.summary_tasks.add(task)
        task.add_done_callback(self.summary_done)

    def summary_done(self, task):
        self.summary_tasks.discard(task)
        if not task.cancelled() and task.exception():
            logger.warning("Telephone summary failed; transcript remains in phone_calls")

    def router(self):
        router = APIRouter()

        @router.post("/api/twilio/voice")
        async def voice(request: Request):
            form = await self.signed_form(request)
            if not self.settings.api_key:
                return self.unavailable("FlowQ telephone service is not configured yet. Please try the shop chat.")
            callback_id = request.query_params.get("callback_id")
            direction = str(form.get("Direction", "inbound"))
            if direction != "inbound" and not callback_id:
                raise HTTPException(403, "Outbound calls require a scheduled callback")
            try:
                # In outbound legs From is OUR Twilio number; To is the customer.
                caller = normalize_phone(str(form.get("To" if callback_id else "From", "")))
            except ValueError as error:
                raise HTTPException(422, "A valid caller phone number is required") from error
            call = self.reserve(form["CallSid"], caller, callback_id=callback_id)
            if not call:
                return self.unavailable("The shop assistant is on another call. Please try again shortly.")
            twiml = VoiceResponse()
            stream = twiml.connect().stream(url=self.stream_url)
            stream.parameter(name="phone", value=caller)
            stream.parameter(name="stream_token", value=call["token"])
            twiml.hangup()
            return Response(str(twiml), media_type="application/xml")

        @router.post("/api/twilio/status")
        async def status(request: Request):
            form = await self.signed_form(request)
            if form.get("CallStatus") in TERMINAL_STATUSES:
                call_sid = form["CallSid"]
                bridge = self.bridges.get(call_sid)
                if bridge:
                    bridge.end_reason = str(form["CallStatus"])
                    bridge.stop.set()
                else:
                    with self.db.connection(write=True) as conn:
                        conn.execute("DELETE FROM phone_call_slot WHERE call_sid=?", (call_sid,))
                        conn.execute("UPDATE phone_calls SET phase='ended',end_reason=? WHERE call_sid=? AND phase!='ended'",
                                     (form["CallStatus"], call_sid))
                with self.db.connection(write=True) as conn:
                    jobs = conn.execute("SELECT id FROM phone_callbacks WHERE call_sid=?", (call_sid,)).fetchall()
                    for job in jobs:
                        conn.execute("DELETE FROM phone_call_slot WHERE call_sid=?", ("callback:" + job["id"],))
            return {"ok": True}

        @router.websocket("/api/twilio/media")
        async def media(ws: WebSocket):
            if not self.configured or not self.settings.api_key or ws.url.query:
                await ws.close(code=1008)
                return
            signature = ws.headers.get("x-twilio-signature", "")
            # Twilio documents a trailing-slash variant for WSS handshake signatures.
            if not any(self.validate_signature(url, {}, signature) for url in (self.stream_url, self.stream_url + "/")):
                await ws.close(code=1008)
                return
            await ws.accept()
            call, bridge = None, None
            try:
                async with asyncio.timeout(START_TIMEOUT_SECONDS):
                    while True:
                        message = await ws.receive_json()
                        if message.get("event") == "start":
                            call = self.activate(message.get("start", {}))
                            bridge = PhoneBridge(self, ws, call, message["start"]["streamSid"])
                            self.bridges[call["call_sid"]] = bridge
                            break
                        if message.get("event") != "connected":
                            raise ValueError("Expected Twilio start event")
                await bridge.run()
            except (ValueError, TimeoutError, WebSocketDisconnect):
                if bridge:
                    bridge.end_reason = "disconnected"
            except Exception:
                logger.warning("Twilio audio bridge failed")
                if bridge:
                    bridge.end_reason = "provider_error"
            finally:
                if call:
                    self.bridges.pop(call["call_sid"], None)
                    transcript = bridge.transcript_text()
                    # Close first so Twilio resumes <Hangup> without waiting for a REST request.
                    # Keep the single-call slot until the telephone leg has been ended.
                    with suppress(RuntimeError, WebSocketDisconnect):
                        await ws.close()
                    if bridge.end_reason not in TERMINAL_STATUSES | {"hangup", "disconnected"}:
                        await self.complete_remote(call["call_sid"])
                    self.finish(call["call_sid"], bridge.end_reason, transcript)
                    self.queue_summary(call["phone"], transcript)
                with suppress(RuntimeError, WebSocketDisconnect):
                    await ws.close()

        return router
