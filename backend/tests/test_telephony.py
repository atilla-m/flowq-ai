import asyncio
import base64
from contextlib import asynccontextmanager
from dataclasses import replace
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from PIL import Image
import pytest
from starlette.websockets import WebSocketDisconnect
from twilio.request_validator import RequestValidator

from backend.config import Settings
from backend.db import normalize_phone
from backend.main import create_app
from backend.telephony import TwilioGateway

ACCOUNT = "AC" + "1" * 32
CALL = "CA" + "2" * 32
OTHER_CALL = "CA" + "3" * 32
STREAM = "MZ" + "4" * 32
ACTUAL = "+994551111111"
AYSEL = "+994501234567"
PUBLIC = "https://flowq.example"
TOKEN = "test-auth-token"
FRAME = base64.b64encode(b"\xff" * 160).decode()


class FakeRealtime:
    def __init__(self):
        self.incoming = None
        self.sent = []
        self.connections = []

    def __call__(self, url, **kwargs):
        self.connections.append((url, kwargs))
        return self.connection()

    @asynccontextmanager
    async def connection(self):
        self.incoming = asyncio.Queue()
        yield self

    async def send(self, raw):
        event = json.loads(raw)
        self.sent.append(event)
        if event["type"] == "session.update":
            await self.emit({"type": "session.created"})
            await self.emit({"type": "session.updated"})

    async def recv(self):
        return await self.incoming.get()

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.recv()

    async def emit(self, event):
        await self.incoming.put(json.dumps(event))

    async def wait_sent(self, kind, *, count=1):
        async with asyncio.timeout(2):
            while len([e for e in self.sent if e["type"] == kind]) < count:
                await asyncio.sleep(0.001)
        return [e for e in self.sent if e["type"] == kind][-1]


@pytest.fixture
def phone_client(tmp_path):
    settings = replace(Settings(), api_key="fake-server-key", twilio_account_sid=ACCOUNT,
        twilio_auth_token=TOKEN, twilio_phone_number="+12025550123", public_base_url=PUBLIC,
        demo_caller_phone=ACTUAL, database_path=tmp_path / "phone.sqlite3", upload_dir=tmp_path / "media")
    realtime = FakeRealtime()
    ai = SimpleNamespace(summarize=AsyncMock(return_value="Customer asked for an iPhone 15 and requested photos."),
                         realtime_session=AsyncMock(return_value={"client_secret": "ek_browser"}), close=AsyncMock())
    gateway = SimpleNamespace(dial=AsyncMock(return_value=SimpleNamespace(sid=OTHER_CALL)),
                              complete=AsyncMock(), close=AsyncMock())
    app = create_app(settings, ai, twilio_gateway=gateway, realtime_connector=realtime)
    with TestClient(app) as client:
        yield client, app, realtime, gateway, ai


def webhook(client, *, call_sid=CALL, caller=ACTUAL, url="/api/twilio/voice", extra=None, signature=None):
    body = {"AccountSid": ACCOUNT, "CallSid": call_sid, "From": caller, "To": "+12025550123", "Direction": "inbound"}
    body.update(extra or {})
    signed = RequestValidator(TOKEN).compute_signature(PUBLIC + url, body)
    return client.post(url, data=body, headers={"X-Twilio-Signature": signed if signature is None else signature})


def parameters(response):
    root = ET.fromstring(response.text)
    stream = root.find("./Connect/Stream")
    assert stream is not None
    return stream, {p.attrib["name"]: p.attrib["value"] for p in stream.findall("Parameter")}


def start(ws, params, *, call_sid=CALL):
    ws.send_json({"event": "connected", "protocol": "Call", "version": "1.0.0"})
    ws.send_json({"event": "start", "streamSid": STREAM, "start": {
        "accountSid": ACCOUNT, "callSid": call_sid, "streamSid": STREAM,
        "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
        "customParameters": params}})


def ws_headers(*, trailing_slash=False):
    url = "wss://flowq.example/api/twilio/media" + ("/" if trailing_slash else "")
    return {"X-Twilio-Signature": RequestValidator(TOKEN).compute_signature(url, {})}


def emit(client, realtime, event):
    client.portal.call(realtime.emit, event)


def wait_sent(client, realtime, kind, count=1):
    async def wait():
        return await realtime.wait_sent(kind, count=count)
    return client.portal.call(wait)


def hangup(ws):
    ws.send_json({"event": "stop", "streamSid": STREAM, "stop": {"callSid": CALL}})
    assert ws.receive()["type"] == "websocket.close"


def test_signed_twiml_binds_normalized_caller_and_demo_memory(phone_client):
    client, app, realtime, gateway, ai = phone_client
    response = webhook(client, caller="055 111 11 11")
    assert response.status_code == 200
    stream, params = parameters(response)
    assert stream.attrib["url"] == "wss://flowq.example/api/twilio/media"
    assert params["phone"] == ACTUAL and len(params["stream_token"]) > 30
    assert "fake-server-key" not in response.text and TOKEN not in response.text
    with app.state.db.connection() as conn:
        call = conn.execute("SELECT * FROM phone_calls").fetchone()
        assert call["phone"] == AYSEL and call["caller"] == ACTUAL
        assert call["deadline"] - call["created_at"] == 300
    # Browser session stays available and uses the same customer, without opening a bridge.
    assert client.post("/api/realtime/session", json={"phone": AYSEL}).json() == {"client_secret": "ek_browser"}
    assert not realtime.connections


def test_signatures_reject_spoofing_and_wrong_accounts(phone_client):
    client, app, *_ = phone_client
    assert webhook(client, signature="bad").status_code == 403
    assert webhook(client, signature="").status_code == 403
    assert webhook(client, extra={"AccountSid": "AC" + "9" * 32}).status_code == 403
    assert webhook(client, caller="anonymous").status_code == 422
    assert webhook(client, extra={"Direction": "outbound-api"}).status_code == 403
    with app.state.db.connection() as conn:
        assert conn.execute("SELECT count(*) FROM phone_calls").fetchone()[0] == 0
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/twilio/media", headers={"x-twilio-signature": "bad"}):
            pass


def test_unconfigured_telephony_leaves_existing_routes_working(tmp_path):
    app = create_app(replace(Settings(), database_path=tmp_path / "empty.sqlite3", upload_dir=tmp_path / "media"))
    with TestClient(app) as client:
        assert client.post("/api/twilio/voice", data={}).status_code == 503
        assert client.get("/api/health").json() == {"ok": True}
        assert len(client.get("/api/customers").json()) == 20
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/twilio/media"):
                pass


def test_missing_openai_key_returns_polite_hangup_without_reservation(tmp_path):
    settings = replace(Settings(), twilio_account_sid=ACCOUNT, twilio_auth_token=TOKEN,
        twilio_phone_number="+12025550123", public_base_url=PUBLIC,
        database_path=tmp_path / "empty.sqlite3", upload_dir=tmp_path / "media")
    app = create_app(settings)
    with TestClient(app) as client:
        response = webhook(client)
        assert response.status_code == 200 and "not configured" in response.text
        assert ET.fromstring(response.text).find("Hangup") is not None
        with app.state.db.connection() as conn:
            assert not conn.execute("SELECT 1 FROM phone_call_slot").fetchone()


def test_one_concurrent_call_including_reservations(phone_client):
    client, app, *_ = phone_client
    first = webhook(client)
    assert webhook(client).text == first.text  # webhook retry is idempotent
    busy = webhook(client, call_sid=OTHER_CALL, caller="+994509876543")
    assert busy.status_code == 200 and "another call" in busy.text
    with app.state.db.connection() as conn:
        assert conn.execute("SELECT count(*) FROM phone_calls").fetchone()[0] == 1


@pytest.mark.parametrize("tamper", ["stream_token", "phone", "callSid", "accountSid", "mediaFormat"])
def test_stream_must_match_reserved_call(phone_client, tamper):
    client, app, realtime, *_ = phone_client
    _, params = parameters(webhook(client))
    event = {"accountSid": ACCOUNT, "callSid": CALL, "streamSid": STREAM,
             "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
             "customParameters": dict(params)}
    if tamper in params:
        event["customParameters"][tamper] = "bad" if tamper == "stream_token" else "+994509876543"
    else:
        event[tamper] = {"encoding": "pcm", "sampleRate": 24000, "channels": 1} if tamper == "mediaFormat" else OTHER_CALL
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        ws.send_json({"event": "start", "start": event})
        assert ws.receive()["type"] == "websocket.close"
    assert not realtime.connections


def test_audio_bridge_phone_tools_interrupt_and_hangup_memory(phone_client):
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers(trailing_slash=True)) as ws:
        start(ws, params)
        config = wait_sent(client, realtime, "session.update")["session"]
        assert config["audio"]["input"]["format"] == {"type": "audio/pcmu"}
        assert config["audio"]["output"]["format"] == {"type": "audio/pcmu"}
        assert config["audio"]["output"]["voice"] == "marin"
        assert len(config["tools"]) == 17 and "Aysel Məmmədova" in config["instructions"]
        assert "channel phone" in config["instructions"]
        assert realtime.connections[0][1]["additional_headers"] == {"Authorization": "Bearer fake-server-key"}
        ws.send_json({"event": "media", "streamSid": STREAM, "media": {"timestamp": "1000", "track": "inbound", "payload": FRAME}})
        assert wait_sent(client, realtime, "input_audio_buffer.append")["audio"] == FRAME
        emit(client, realtime, {"type": "input_audio_buffer.speech_stopped"})
        emit(client, realtime, {"type": "response.created", "response": {"id": "r1"}})
        audio = base64.b64encode(b"\xff" * 1600).decode()  # 200 ms
        emit(client, realtime, {"type": "response.output_audio.delta", "response_id": "r1", "item_id": "a1", "content_index": 0, "delta": audio})
        assert ws.receive_json() == {"event": "media", "streamSid": STREAM, "media": {"payload": audio}}
        mark = ws.receive_json()
        assert mark["event"] == "mark"
        emit(client, realtime, {"type": "response.output_audio_transcript.done", "item_id": "a1", "transcript": "Unheard long text must not enter memory."})
        ws.send_json({"event": "media", "streamSid": STREAM, "media": {"timestamp": "1100", "payload": FRAME}})
        wait_sent(client, realtime, "input_audio_buffer.append", 2)
        emit(client, realtime, {"type": "input_audio_buffer.speech_started"})
        assert ws.receive_json()["event"] == "clear"
        truncate = wait_sent(client, realtime, "conversation.item.truncate")
        assert truncate == {"type": "conversation.item.truncate", "item_id": "a1", "content_index": 0, "audio_end_ms": 100}
        # A mark flushed by clear must not be mistaken for audio heard by the customer.
        ws.send_json(mark)
        emit(client, realtime, {"type": "response.done", "response": {"id": "r1", "status": "cancelled"}})
        emit(client, realtime, {"type": "conversation.item.input_audio_transcription.completed", "item_id": "u1", "transcript": "I want to trade in my iPhone 13."})
        emit(client, realtime, {"type": "input_audio_buffer.speech_stopped"})
        emit(client, realtime, {"type": "response.created", "response": {"id": "r2"}})
        tool_event = {"type": "response.done", "response": {"id": "r2", "status": "completed", "output": [
            {"type": "function_call", "call_id": "fc1", "name": "request_media_whatsapp", "arguments": '{"what":"Trade-in photos"}'}]}}
        emit(client, realtime, tool_event)
        output = wait_sent(client, realtime, "conversation.item.create")
        assert output["item"]["type"] == "function_call_output" and json.loads(output["item"]["output"])["sent"]
        emit(client, realtime, tool_event)  # completed events must not duplicate side effects
        inbox = client.get("/api/inbox", params={"phone": AYSEL}).json()
        assert len([m for m in inbox["messages"] if m["type"] == "media_request"]) == 1
        assert "Please upload" in inbox["messages"][0]["text"]
        assert any(t["tool"] == "request_media_whatsapp" and t["channel"] == "phone" for t in app.state.db.trace(AYSEL))
        hangup(ws)
    async def summaries():
        await asyncio.gather(*list(app.state.telephony.summary_tasks))
    client.portal.call(summaries)
    transcript = ai.summarize.call_args.args[0]
    assert "I want to trade in" in transcript and "request_media_whatsapp" in transcript
    assert "Unheard long text" not in transcript and "interrupted at 100" in transcript
    history = app.state.db.history(AYSEL)
    assert history["conversations"][0]["channel"] == "phone"
    with app.state.db.connection() as conn:
        assert not conn.execute("SELECT 1 FROM phone_call_slot").fetchone()
        assert conn.execute("SELECT count(*) FROM phone_turns").fetchone()[0] == 2
        metric = conn.execute("SELECT * FROM phone_turns WHERE response_id='r1'").fetchone()
        assert metric["speech_to_first_audio_ms"] >= 0 and metric["response_ms"] >= 0
    gateway.complete.assert_not_called()
    # Browser callback still creates the existing browser event and never dials Twilio.
    result = client.post("/api/tools/schedule_callback", json={"phone": AYSEL, "channel": "voice", "args": {"delay_seconds": 0}}).json()["result"]
    assert "event_id" in result
    gateway.dial.assert_not_called()


def test_callbacks_dial_actual_caller_after_hangup_and_outbound_uses_to(phone_client):
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        wait_sent(client, realtime, "response.create")
        async def schedule():
            return await app.state.tools.execute("schedule_callback", AYSEL, "phone", {"delay_seconds": 0})
        result = client.portal.call(schedule)
        again = client.portal.call(schedule)
        assert result["callback_id"] == again["callback_id"] and result["channel"] == "phone"
        client.portal.call(app.state.telephony.dispatch_callback)
        gateway.dial.assert_not_called()  # still on the original call
        assert not client.get("/api/inbox", params={"phone": AYSEL}).json()["events"]
        hangup(ws)
    client.portal.call(app.state.telephony.dispatch_callback)
    gateway.dial.assert_awaited_once_with(ACTUAL, result["callback_id"], PUBLIC)
    outbound = webhook(client, call_sid=OTHER_CALL, caller="+12025550123",
        url="/api/twilio/voice?callback_id=" + result["callback_id"], extra={"Direction": "outbound-api", "To": ACTUAL})
    assert parameters(outbound)[1]["phone"] == ACTUAL
    with app.state.db.connection() as conn:
        assert conn.execute("SELECT phone FROM phone_calls WHERE call_sid=?", (OTHER_CALL,)).fetchone()[0] == AYSEL
    assert "another call" in webhook(client, call_sid="CA" + "5" * 32).text
    response = webhook(client, call_sid=OTHER_CALL, url="/api/twilio/status", extra={"CallStatus": "no-answer"})
    assert response.json() == {"ok": True}
    with app.state.db.connection() as conn:
        assert not conn.execute("SELECT 1 FROM phone_call_slot").fetchone()
    client.portal.call(app.state.telephony.dispatch_callback)
    assert gateway.dial.await_count == 1


def test_phone_limit_closes_stream_and_completes_call(phone_client, monkeypatch):
    import backend.telephony as module
    monkeypatch.setattr(module, "MAX_CALL_SECONDS", 0.15)
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        assert ws.receive()["type"] == "websocket.close"
    gateway.complete.assert_awaited_once_with(CALL)
    with app.state.db.connection() as conn:
        assert conn.execute("SELECT end_reason FROM phone_calls").fetchone()[0] == "time_limit"
        assert not conn.execute("SELECT 1 FROM phone_call_slot").fetchone()


def test_upstream_error_hangs_up_and_releases_slot(phone_client):
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        wait_sent(client, realtime, "response.create")
        emit(client, realtime, {"type": "error", "error": {"code": "server_error"}})
        assert ws.receive()["type"] == "websocket.close"
    gateway.complete.assert_awaited_once_with(CALL)
    assert parameters(webhook(client, call_sid=OTHER_CALL))[0] is not None


def test_gateway_uses_post_signed_routes_and_five_minute_limit(monkeypatch):
    import backend.telephony as module
    http = SimpleNamespace(close=AsyncMock())
    calls = SimpleNamespace(create_async=AsyncMock(return_value=SimpleNamespace(sid=CALL)))
    monkeypatch.setattr(module, "AsyncTwilioHttpClient", lambda **kwargs: http)
    monkeypatch.setattr(module, "Client", lambda *args, **kwargs: SimpleNamespace(calls=calls))
    settings = replace(Settings(), twilio_account_sid=ACCOUNT, twilio_auth_token=TOKEN, twilio_phone_number="+12025550123")
    async def run():
        gateway = TwilioGateway(settings)
        await gateway.dial(ACTUAL, "job", PUBLIC)
        await gateway.close()
    asyncio.run(run())
    args = calls.create_async.call_args.kwargs
    assert args["to"] == ACTUAL and args["from_"] == settings.twilio_phone_number
    assert args["time_limit"] == 300 and args["timeout"] == 30
    assert args["url"] == PUBLIC + "/api/twilio/voice?callback_id=job"
    assert args["status_callback"] == PUBLIC + "/api/twilio/status"


def test_phone_upload_notifies_realtime_without_frontend_changes(phone_client):
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        wait_sent(client, realtime, "response.create")
        picture = BytesIO()
        Image.new("RGB", (24, 24), "white").save(picture, "PNG")
        upload = client.post("/api/media", data={"phone": AYSEL}, files={"file": ("screen.png", picture.getvalue(), "image/png")})
        assert upload.status_code == 200
        notice = wait_sent(client, realtime, "conversation.item.create")
        assert notice["item"]["type"] == "message" and notice["item"]["role"] == "user"
        assert upload.json()["media_id"] in notice["item"]["content"][0]["text"]
        hangup(ws)


def test_callback_hangs_up_only_after_goodbye_playback(phone_client):
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        wait_sent(client, realtime, "response.create")
        emit(client, realtime, {"type": "response.created", "response": {"id": "schedule"}})
        emit(client, realtime, {"type": "response.done", "response": {"id": "schedule", "status": "completed", "output": [
            {"type": "function_call", "call_id": "callback-tool", "name": "schedule_callback", "arguments": '{"delay_seconds":15}'}]}})
        output = wait_sent(client, realtime, "conversation.item.create")
        assert json.loads(output["item"]["output"])["scheduled"]
        wait_sent(client, realtime, "response.create", 2)
        emit(client, realtime, {"type": "response.created", "response": {"id": "goodbye"}})
        emit(client, realtime, {"type": "response.output_audio.delta", "response_id": "goodbye", "item_id": "bye", "delta": FRAME})
        assert ws.receive_json()["event"] == "media"
        mark = ws.receive_json()
        emit(client, realtime, {"type": "response.output_audio_transcript.done", "item_id": "bye", "transcript": "I will call you back shortly. Goodbye!"})
        emit(client, realtime, {"type": "response.done", "response": {"id": "goodbye", "status": "completed", "output": []}})
        with app.state.db.connection() as conn:
            assert conn.execute("SELECT phase FROM phone_calls").fetchone()[0] == "active"
        gateway.complete.assert_not_called()
        ws.send_json(mark)
        assert ws.receive()["type"] == "websocket.close"
    gateway.complete.assert_awaited_once_with(CALL)
    with app.state.db.connection() as conn:
        assert conn.execute("SELECT end_reason FROM phone_calls").fetchone()[0] == "callback_requested"
        transcript = conn.execute("SELECT transcript FROM phone_calls").fetchone()[0]
        assert "Goodbye!" in transcript


def test_slow_tool_does_not_block_interruptions(phone_client, monkeypatch):
    client, app, realtime, gateway, ai = phone_client
    original = app.state.tools.execute
    gate = None
    started = None
    async def setup():
        nonlocal gate, started
        gate, started = asyncio.Event(), asyncio.Event()
    client.portal.call(setup)
    async def slow_tool(name, phone, channel, args):
        started.set()
        await gate.wait()
        return await original(name, phone, channel, args)
    monkeypatch.setattr(app.state.tools, "execute", slow_tool)
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        wait_sent(client, realtime, "response.create")
        emit(client, realtime, {"type": "response.created", "response": {"id": "slow"}})
        emit(client, realtime, {"type": "response.done", "response": {"id": "slow", "status": "completed", "output": [
            {"type": "function_call", "call_id": "slow-tool", "name": "search_inventory", "arguments": '{"query":"iPhone 15"}'}]}})
        client.portal.call(started.wait)
        emit(client, realtime, {"type": "input_audio_buffer.speech_started"})
        assert ws.receive_json()["event"] == "clear"
        assert not gate.is_set()
        client.portal.call(gate.set)
        assert wait_sent(client, realtime, "conversation.item.create")["item"]["call_id"] == "slow-tool"
        hangup(ws)


def test_twilio_settings_from_env_and_bad_public_origin_does_not_break_browser(monkeypatch, tmp_path):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", ACCOUNT)
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", TOKEN)
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+12025550123")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://unsafe.example")
    monkeypatch.setenv("DEMO_CALLER_PHONE", ACTUAL)
    settings = replace(Settings.from_env(), api_key="", database_path=tmp_path / "env.sqlite3", upload_dir=tmp_path / "media")
    assert settings.twilio_account_sid == ACCOUNT and settings.demo_caller_phone == ACTUAL
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/health").status_code == 200
        assert client.post("/api/twilio/voice", data={}).status_code == 503


def test_real_callback_failure_is_logged_without_secrets(phone_client):
    client, app, realtime, gateway, ai = phone_client
    _, params = parameters(webhook(client))
    with client.websocket_connect("/api/twilio/media", headers=ws_headers()) as ws:
        start(ws, params)
        wait_sent(client, realtime, "response.create")
        async def schedule():
            return await app.state.tools.execute("schedule_callback", AYSEL, "phone", {"delay_seconds": 0})
        result = client.portal.call(schedule)
        hangup(ws)
    gateway.dial.side_effect = RuntimeError("provider error containing " + TOKEN)
    client.portal.call(app.state.telephony.dispatch_callback)
    with app.state.db.connection() as conn:
        job = conn.execute("SELECT * FROM phone_callbacks WHERE id=?", (result["callback_id"],)).fetchone()
        assert job["status"] == "failed" and TOKEN not in job["error"]
        assert not conn.execute("SELECT 1 FROM phone_call_slot").fetchone()
    assert TOKEN not in json.dumps(client.get("/api/trace", params={"phone": AYSEL}).json())
    client.portal.call(app.state.telephony.dispatch_callback)
    assert gateway.dial.await_count == 1


@pytest.mark.parametrize("value, expected", [("050 123 45 67", AYSEL), ("994501234567", AYSEL),
                                               ("00994501234567", AYSEL), ("+12025550123", "+12025550123")])
def test_caller_normalization(value, expected):
    assert normalize_phone(value) == expected
