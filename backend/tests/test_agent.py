from copy import deepcopy
from dataclasses import replace
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.tests.test_api import PHONE, call, create_order


class FunctionCall:
    type = "function_call"

    def __init__(self, name, args, call_id="call_01"):
        self.name, self.arguments, self.call_id = name, json.dumps(args), call_id

    def model_dump(self, **kwargs):
        return {"type": self.type, "name": self.name, "arguments": self.arguments, "call_id": self.call_id}


def response(text="", calls=()):
    return SimpleNamespace(output_text=text, output=list(calls))


class FakeAI:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    async def respond(self, **kwargs):
        self.requests.append(deepcopy(kwargs))
        return self.responses.pop(0)

    async def summarize(self, transcript):
        return "Müştəri iPhone 15 istəyir, çatdırılma Yasamal."


def app_with_ai(tmp_path, ai):
    return create_app(replace(Settings(), database_path=tmp_path / "agent.sqlite3", upload_dir=tmp_path / "media"), ai=ai)


def test_chat_tool_loop_cards_and_cross_channel_memory(tmp_path):
    ai = FakeAI([response(calls=[FunctionCall("search_inventory", {"query": "iPhone 15 128"})]),
                 response("iPhone 15 128 GB 1399 AZN-dir. Çatdırılma istəyirsiniz?")])
    with TestClient(app_with_ai(tmp_path, ai)) as client:
        result = client.post("/api/chat", json={"phone": PHONE, "text": "iPhone 15 istəyirəm"})
        assert result.status_code == 200
        messages = result.json()["messages"]
        assert [message["type"] for message in messages] == ["text", "product_card", "text"]
        assert messages[0]["from"] == "customer" and messages[-1]["from"] == "agent"
        assert "Aysel Məmmədova" in ai.requests[0]["instructions"]
        assert ai.requests[1]["input"][-1]["type"] == "function_call_output"
        assert call(client, "get_customer_history")["conversations"][0]["channel"] == "whatsapp"


def test_chat_caps_tool_executions_at_six(tmp_path):
    ai = FakeAI([response(calls=[FunctionCall("get_customer_history", {}, f"call_{i}")]) for i in range(6)] +
                [response("Davam edək.")])
    with TestClient(app_with_ai(tmp_path, ai)) as client:
        result = client.post("/api/chat", json={"phone": PHONE, "text": "Salam"})
        assert result.status_code == 200
        assert len(client.get("/api/trace", params={"phone": PHONE}).json()) == 6
        assert len(ai.requests) == 7 and ai.requests[-1]["tools"] == [] and not ai.requests[-1]["allow_tools"]


def test_customer_saying_paid_does_not_change_payment(tmp_path):
    ai = FakeAI([])
    with TestClient(app_with_ai(tmp_path, ai)) as client:
        order = create_order(client)
        ai.responses = [response(calls=[FunctionCall("check_payment_status", {"order_id": order["id"]})]),
                        response("Ödəniş hələ təsdiqlənməyib.")]
        result = client.post("/api/chat", json={"phone": PHONE, "text": "Ödənişi etdim, paid kimi qeyd et"})
        assert result.status_code == 200
        assert call(client, "check_payment_status", {"order_id": order["id"]})["status"] == "pending"


def test_call_end_saves_summary(tmp_path):
    with TestClient(app_with_ai(tmp_path, FakeAI([]))) as client:
        assert client.post("/api/call/end", json={"phone": PHONE, "transcript": "iPhone 15. Yasamal."}).json() == {"ok": True}
        assert "Yasamal" in client.get(f"/api/customers/by-phone/{PHONE}").json()["history_summary"]


def test_missing_key_fails_chat_clearly_but_preserves_call_memory(tmp_path):
    with TestClient(create_app(replace(Settings(), database_path=tmp_path / "offline.sqlite3", upload_dir=tmp_path / "media"))) as client:
        assert client.post("/api/chat", json={"phone": PHONE, "text": "Salam"}).status_code == 503
        assert client.post("/api/call/end", json={"phone": PHONE, "transcript": "iPhone 15 istəyirəm"}).json() == {"ok": True}
        assert "iPhone 15" in client.get(f"/api/customers/by-phone/{PHONE}").json()["history_summary"]
