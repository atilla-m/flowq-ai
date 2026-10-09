from dataclasses import replace
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend.config import Settings
from backend.db import Database, dumps, now_iso
from backend.main import create_app


PHONE = "+994501234567"
OTHER = "+994551234567"


@pytest.fixture
def client(tmp_path):
    app = create_app(replace(Settings(), database_path=tmp_path / "api.sqlite3", upload_dir=tmp_path / "uploads"))
    with TestClient(app) as client:
        yield client


def call(client, name, args=None, *, phone=PHONE, channel="voice"):
    response = client.post(f"/api/tools/{name}", json={"phone": phone, "channel": channel, "args": args or {}})
    assert response.status_code == 200
    return response.json()["result"]


def create_order(client, **extra):
    return call(client, "create_order", {"items": [{"sku": "IP15-128-BLK"}], "address": "Yasamal", **extra})


def verified_quote(client):
    db = client.app.state.db
    result = {"model": "iPhone 13", "storage": 128, "battery_health": 79,
              "screen_cracked": True, "back_cracked": False, "other_damage": [],
              "confidence": .99, "mismatches": [], "need_retake": False}
    with db.connection(write=True) as connection:
        connection.execute("INSERT INTO analyses VALUES (?, ?, ?, ?, ?)",
                           ("analysis_test", PHONE, now_iso(), "[]", dumps(result)))
    return call(client, "calculate_tradein", {"device_info": {"analysis_id": "analysis_test", "model": "iPhone 16",
        "battery_health": 100, "screen_cracked": False, "powers_on": True, "water_damage": False,
        "repaired_before": False, "face_id_working": True, "icloud_signed_out": False}})


def test_contract_health_customers_and_cors(client):
    assert client.get("/api/health").json() == {"ok": True}
    assert len(client.get("/api/customers").json()) == 8
    history = client.get(f"/api/customers/by-phone/{PHONE}").json()
    assert history["name"] == "Aysel Məmmədova" and history["history_summary"]
    response = client.options("/api/tools/search_inventory", headers={"Origin": "http://localhost:5173",
                           "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert response.headers["access-control-allow-origin"] == "*"


def test_voice_pushes_media_request_and_logs_call(client):
    result = call(client, "request_media_whatsapp", {"what": "Trade-in üçün"})
    assert result["sent"]
    inbox = client.get("/api/inbox", params={"phone": PHONE}).json()
    assert inbox["messages"][0]["type"] == "media_request"
    assert "Settings > Battery" in inbox["messages"][0]["text"]
    trace = client.get("/api/trace", params={"phone": PHONE}).json()
    assert trace[0]["channel"] == "voice" and trace[0]["latency_ms"] >= 0


def test_payment_paid_only_by_endpoint(client):
    order = create_order(client)
    order_id = order["id"]
    assert order["total"] == 1402 and order["status"] == "awaiting_payment"
    assert call(client, "create_payment_link", {"order_id": order_id})["status"] == "pending"
    assert call(client, "check_payment_status", {"order_id": order_id})["status"] == "pending"
    attempted = call(client, "check_payment_status", {"order_id": order_id, "status": "paid"})
    assert attempted["error"] == "invalid_arguments"
    assert client.get(f"/api/orders/{order_id}").json()["status"] == "awaiting_payment"
    assert client.post(f"/api/payments/{order_id}/pay").json() == {"status": "paid"}
    assert call(client, "check_payment_status", {"order_id": order_id})["status"] == "paid"
    assert client.get(f"/api/orders/{order_id}").json()["status"] == "paid"
    first_events = client.get("/api/inbox", params={"phone": PHONE}).json()["events"]
    assert client.post(f"/api/payments/{order_id}/pay").status_code == 200
    assert client.get("/api/inbox", params={"phone": PHONE}).json()["events"] == first_events


def test_photos_override_claims_and_negotiation_cannot_forge_base(client):
    quote = verified_quote(client)
    assert quote["base_offer"] == 480 and quote["final_offer"] == 300
    result = call(client, "negotiate_offer", {"quote_id": quote["quote_id"], "base_offer": 100000,
                                             "current_offer": 5000, "customer_ask": 10000})
    assert result["new_offer"] == 306
    for _ in range(5):
        result = call(client, "negotiate_offer", {"quote_id": quote["quote_id"], "customer_ask": 10000})
    assert result["new_offer"] == 315 and result["is_final"]
    order = create_order(client, tradein_quote_id=quote["quote_id"])
    assert order["total"] == 1399 - 315 + 3
    assert order["tradein"]["device_info"]["screen_cracked"] is True
    assert create_order(client, tradein_quote_id=quote["quote_id"])["error"]


def test_calculation_requires_vision_and_checklist(client):
    assert call(client, "calculate_tradein", {"device_info": {"model": "iPhone 13"}})["need_retake"]
    verified_quote(client)
    result = call(client, "calculate_tradein", {"device_info": {"analysis_id": "analysis_test"}})
    assert result["needs_clarification"] and "water_damage" in result["missing_fields"]


def test_order_rejects_forged_totals_and_wrong_accessory(client):
    assert create_order(client, total=1)["error"] == "invalid_arguments"
    result = call(client, "create_order", {"items": [{"sku": "IP15-128-BLK"}, {"sku": "ACC-003"}], "address": "pickup"})
    assert result["error"]
    result = call(client, "create_order", {"items": [{"sku": "IP15-128-BLK"}, {"sku": "ACC-006"}], "address": "pickup"})
    assert result["total"] == 1428


def test_order_stock_reservation_and_idempotency(client):
    first = create_order(client, idempotency_key="same-order")
    second = create_order(client, idempotency_key="same-order")
    assert first["id"] == second["id"]
    items = call(client, "search_inventory", {"query": "iPhone 15 128"})["items"]
    assert items[0]["stock"] == 4
    result = call(client, "create_order", {"items": [{"sku": "IP16P-256-BLK"}], "address": "pickup"})
    assert result["error"]


def test_tools_cannot_access_other_customer(client):
    order = create_order(client)
    assert call(client, "check_payment_status", {"order_id": order["id"]}, phone=OTHER)["error"]
    assert call(client, "get_customer_history", {"phone": OTHER})["error"]


def test_callback_and_handoff_contract(client):
    assert call(client, "schedule_callback", {"delay_seconds": 0})["scheduled"]
    assert call(client, "handoff_to_human", {"summary": "Manager requested"})["handed_off"]
    inbox = client.get("/api/inbox", params={"phone": PHONE}).json()
    assert {event["type"] for event in inbox["events"]} == {"incoming_callback", "handoff"}
    assert client.get("/api/inbox", params={"phone": PHONE, "since": "bad"}).status_code == 422


def test_media_upload_and_model_labeled_accessory_image(client):
    buffer = BytesIO()
    Image.new("RGB", (30, 30), "white").save(buffer, format="PNG")
    response = client.post("/api/media", data={"phone": PHONE}, files={"file": ("screen.png", buffer.getvalue(), "image/png")})
    assert response.status_code == 200
    media = response.json()
    assert client.get(f"/api/media/{media['media_id']}").headers["content-type"] == "image/png"
    messages = client.get("/api/inbox", params={"phone": PHONE}).json()["messages"]
    assert messages[0]["type"] == "image" and messages[0]["data"]["media_id"] == media["media_id"]
    assert client.post("/api/media", data={"phone": PHONE}, files={"file": ("bad.png", b"bad", "image/png")}).status_code == 415
    image = client.get("/api/assets/accessories/ACC-006.svg")
    assert image.status_code == 200 and "iPhone 15" in image.text


def test_whatsapp_product_cards(client):
    call(client, "search_inventory", {"query": "iPhone 15"}, channel="whatsapp")
    call(client, "get_accessories", {"phone_model": "iPhone 15"}, channel="whatsapp")
    messages = client.get("/api/inbox", params={"phone": PHONE}).json()["messages"]
    assert all(message["type"] == "product_card" for message in messages)
    assert any(message.get("image_url", "").endswith("ACC-006.svg") for message in messages)
