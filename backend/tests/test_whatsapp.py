from dataclasses import replace
from io import BytesIO
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from PIL import Image
import pytest
from twilio.request_validator import RequestValidator

from backend.config import Settings
from backend.main import create_app
from backend.whatsapp import WhatsAppGateway, render

ACCOUNT = "AC" + "1" * 32
MESSAGE = "SM" + "5" * 32
ACTUAL = "+994551111111"
AYSEL = "+994501234567"
ELVIN = "+994551234567"
PUBLIC = "https://flowq.example"
TOKEN = "test-auth-token"
SANDBOX = "whatsapp:+14155238886"
URL = "/api/twilio/whatsapp"
MEDIA_URL = f"https://api.twilio.com/2010-04-01/Accounts/{ACCOUNT}/Messages/{MESSAGE}/Media/ME" + "6" * 32


def jpeg() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (32, 48), "gray").save(buffer, "JPEG")
    return buffer.getvalue()


def until(condition, timeout=3.0):
    """The delivery worker and inbound handler run on the app's event loop; poll from the test thread."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


def settled(seconds=0.9):
    time.sleep(seconds)  # longer than one delivery poll


@pytest.fixture
def wa(tmp_path):
    settings = replace(Settings(), api_key="fake-server-key", twilio_account_sid=ACCOUNT, twilio_auth_token=TOKEN,
        twilio_whatsapp_from=SANDBOX, public_base_url=PUBLIC, demo_caller_phone=ACTUAL,
        database_path=tmp_path / "wa.sqlite3", upload_dir=tmp_path / "media")
    ai = SimpleNamespace(close=AsyncMock())
    gateway = SimpleNamespace(send=AsyncMock(return_value="SM" + "9" * 32), fetch_media=AsyncMock(return_value=jpeg()),
                              close=AsyncMock())
    app = create_app(settings, ai, whatsapp_gateway=gateway)
    with TestClient(app) as client:
        app.state.agent.turn = AsyncMock(return_value={"messages": []})
        yield client, app, gateway


def inbound(client, *, body="", media=(), sender="whatsapp:" + ACTUAL, sid=MESSAGE, signature=None, account=ACCOUNT):
    form = {"AccountSid": account, "MessageSid": sid, "From": sender, "To": SANDBOX, "Body": body,
            "NumMedia": str(len(media))}
    for index, url in enumerate(media):
        form[f"MediaUrl{index}"] = url
        form[f"MediaContentType{index}"] = "image/jpeg"
    signed = RequestValidator(TOKEN).compute_signature(PUBLIC + URL, form)
    return client.post(URL, data=form, headers={"X-Twilio-Signature": signed if signature is None else signature})


def outbox(app):
    with app.state.db.connection() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM whatsapp_outbox ORDER BY ts")]


def test_agent_messages_for_demo_customer_go_to_their_real_whatsapp(wa):
    client, app, gateway = wa
    app.state.db.add_message(AYSEL, "agent", "text", text="The iPhone 15 is in stock.")
    assert until(lambda: gateway.send.await_count == 1)
    assert gateway.send.await_args.args == ("whatsapp:" + ACTUAL, "The iPhone 15 is in stock.")
    assert outbox(app)[0]["status"] == "sent" and outbox(app)[0]["twilio_sid"].startswith("SM")
    settled()
    assert gateway.send.await_count == 1  # delivered once, not on every poll


def test_only_new_agent_messages_of_that_customer_are_sent(tmp_path):
    settings = replace(Settings(), twilio_account_sid=ACCOUNT, twilio_auth_token=TOKEN, twilio_whatsapp_from=SANDBOX,
        public_base_url=PUBLIC, demo_caller_phone=ACTUAL, database_path=tmp_path / "wa.sqlite3", upload_dir=tmp_path / "media")
    gateway = SimpleNamespace(send=AsyncMock(return_value="SM" + "9" * 32), close=AsyncMock())
    # History written before this process started must never be replayed to a real phone.
    with TestClient(create_app(settings, SimpleNamespace(close=AsyncMock()))) as first:
        first.app.state.db.add_message(AYSEL, "agent", "text", text="old history")
    app = create_app(settings, SimpleNamespace(close=AsyncMock()), whatsapp_gateway=gateway)
    with TestClient(app):
        app.state.db.add_message(ELVIN, "agent", "text", text="for another customer")
        app.state.db.add_message(AYSEL, "customer", "text", text="what the customer typed")
        app.state.db.add_message(AYSEL, "agent", "text", text="new reply")
        assert until(lambda: gateway.send.await_count == 1)
        settled()
    assert [call.args[1] for call in gateway.send.await_args_list] == ["new reply"]


def test_photo_request_tool_reaches_whatsapp_during_a_phone_call(wa):
    client, app, gateway = wa
    async def request():
        return await app.state.tools.execute("request_media_whatsapp", AYSEL, "phone", {"what": "iPhone 12 trade-in"})
    assert client.portal.call(request)["sent"] is True
    assert until(lambda: gateway.send.await_count == 1)
    to, body = gateway.send.await_args.args
    assert to == "whatsapp:" + ACTUAL and "iPhone 12 trade-in" in body and "Please upload" in body


def test_send_failure_is_recorded_without_secrets_and_not_retried(wa):
    client, app, gateway = wa
    failure = RuntimeError("provider error containing " + TOKEN)
    failure.code = 63015
    gateway.send.side_effect = failure
    app.state.db.add_message(AYSEL, "agent", "text", text="hello")
    assert until(lambda: outbox(app) and outbox(app)[0]["status"] == "failed")
    assert outbox(app)[0]["error"] == "twilio_error_63015" and TOKEN not in str(outbox(app))
    settled()
    assert gateway.send.await_count == 1


def test_webhook_requires_a_valid_twilio_signature_and_account(wa):
    client, app, gateway = wa
    assert inbound(client, body="hi", signature="forged").status_code == 403
    assert inbound(client, body="hi", account="AC" + "7" * 32).status_code == 403
    assert client.post(URL, data={"Body": "hi"}).status_code == 403
    settled(0.2)
    app.state.agent.turn.assert_not_awaited()


def test_inbound_text_runs_one_chat_turn_even_if_twilio_retries(wa):
    client, app, gateway = wa
    first = inbound(client, body="Hi, do you have the iPhone 15?")
    assert first.status_code == 200 and first.headers["content-type"].startswith("application/xml")
    assert "<Response>" in first.text
    assert inbound(client, body="Hi, do you have the iPhone 15?").status_code == 200  # same MessageSid again
    assert until(lambda: app.state.agent.turn.await_count == 1)
    settled(0.2)
    app.state.agent.turn.assert_awaited_once_with(AYSEL, "Hi, do you have the iPhone 15?", [])


def test_inbound_photo_is_stored_in_the_inbox_and_starts_a_chat_turn(wa):
    client, app, gateway = wa
    assert inbound(client, media=[MEDIA_URL]).status_code == 200
    assert until(lambda: app.state.agent.turn.await_count == 1)
    gateway.fetch_media.assert_awaited_once_with(MEDIA_URL)
    images = [m for m in client.get("/api/inbox", params={"phone": AYSEL}).json()["messages"] if m["type"] == "image"]
    assert len(images) == 1 and images[0]["from"] == "customer"
    media_id = images[0]["data"]["media_id"]
    assert app.state.agent.turn.await_args.args == (AYSEL, "", [media_id])
    assert client.get(f"/api/media/{media_id}").headers["content-type"] == "image/jpeg"


def test_photo_during_a_phone_call_is_left_to_the_voice_agent(wa):
    client, app, gateway = wa
    # The phone bridge's inbox watcher tells the live call about new customer images.
    app.state.telephony.bridges["CA" + "2" * 32] = SimpleNamespace(phone=AYSEL)
    assert inbound(client, media=[MEDIA_URL]).status_code == 200
    assert until(lambda: any(m["type"] == "image" for m in app.state.db.inbox(AYSEL)["messages"]))
    settled(0.3)
    app.state.agent.turn.assert_not_awaited()
    app.state.telephony.bridges.clear()


def test_unreadable_photo_gets_a_polite_reply_instead_of_silence(wa):
    client, app, gateway = wa
    gateway.fetch_media.return_value = b"not an image"
    assert inbound(client, media=[MEDIA_URL]).status_code == 200
    assert until(lambda: gateway.send.await_count == 1)
    assert "could not open" in gateway.send.await_args.args[1]
    app.state.agent.turn.assert_not_awaited()


def test_other_sandbox_members_are_ignored(wa):
    client, app, gateway = wa
    assert inbound(client, body="hello", sender="whatsapp:+12025550199").status_code == 200
    settled(0.3)
    app.state.agent.turn.assert_not_awaited()
    assert not app.state.db.inbox(AYSEL)["messages"]


def test_failed_chat_turn_apologises(wa):
    client, app, gateway = wa
    app.state.agent.turn.side_effect = RuntimeError("boom " + TOKEN)
    inbound(client, body="hi")
    assert until(lambda: gateway.send.await_count == 1)
    assert gateway.send.await_args.args[1].startswith("Sorry")


def test_whatsapp_is_off_without_configuration(tmp_path):
    settings = replace(Settings(), database_path=tmp_path / "off.sqlite3", upload_dir=tmp_path / "media")
    app = create_app(settings, SimpleNamespace(close=AsyncMock()))
    with TestClient(app) as client:
        assert app.state.whatsapp.worker is None
        assert client.post(URL, data={"Body": "hi"}).status_code == 503


def test_setting_is_read_from_env(monkeypatch):
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", " whatsapp:+14155238886 ")
    assert Settings.from_env().twilio_whatsapp_from == SANDBOX


@pytest.mark.parametrize("message, expected", [
    ({"type": "text", "text": " Hello "}, "Hello"),
    ({"type": "text", "text": ""}, None),
    ({"type": "media_request", "text": "Send 4 photos", "data": {"instructions": "Send 4 photos"}}, "Send 4 photos"),
    ({"type": "product_card", "text": "iPhone 15", "data": {"name": "iPhone 15", "storage": 128, "color": "Black", "price_azn": 1399}},
     "*iPhone 15* (128 GB · Black)\n1399 AZN"),
    ({"type": "product_card", "text": "Case", "data": {"name": "iPhone 15 — Protective case", "price_azn": 29, "compatible_models": ["iPhone 15"]}},
     "*iPhone 15 — Protective case*\n29 AZN\nFits: iPhone 15"),
    ({"type": "payment_link", "text": "Your payment link:", "data": {"order_id": "FQ-1", "url": "https://shop.example/pay/FQ-1"}},
     "Your payment link:\nhttps://shop.example/pay/FQ-1"),
    ({"type": "order_summary", "text": "Order FQ-1", "data": {"id": "FQ-1", "total_azn": 1152.0,
      "items": [{"name": "iPhone 15", "quantity": 1, "line_total_azn": 1399.0}],
      "tradein": {"credit_azn": 250.0}, "delivery": {"district": "Yasamal", "fee_azn": 3}}},
     "*Order FQ-1*\niPhone 15: 1399.0 AZN\nTrade-in: −250.0 AZN\nDelivery (Yasamal): 3 AZN\n*Total: 1152.0 AZN*"),
])
def test_render(message, expected):
    assert render(message) == expected


@pytest.mark.anyio
@pytest.mark.parametrize("url", ["http://api.twilio.com/x", "https://evil.example/x", "https://api.twilio.com.evil.example/x"])
async def test_media_is_only_fetched_from_twilio(url):
    gateway = WhatsAppGateway(replace(Settings(), twilio_account_sid=ACCOUNT, twilio_auth_token=TOKEN))
    with pytest.raises(ValueError):
        await gateway.fetch_media(url)
    await gateway.close()


@pytest.fixture
def anyio_backend():
    return "asyncio"
