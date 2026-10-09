from backend.db import now_iso


PHONE = "+994501234567"


def test_seed_is_idempotent_and_memory_crosses_channels(db, pack):
    db.initialize(pack)
    assert len(db.customers()) == 8
    assert len(db.history(PHONE)["conversations"]) == 1
    db.add_conversation(PHONE, "whatsapp", "iPhone 15, çatdırılma Yasamal.")
    history = db.history(PHONE)
    assert "voice:" in history["history_summary"] and "whatsapp:" in history["history_summary"]


def test_inbox_cursor_and_phone_isolation(db):
    first = db.add_message(PHONE, "agent", "text", text="Salam")
    second = db.add_message(PHONE, "agent", "media_request", text="Şəkil göndərin")
    db.add_message("+994551234567", "agent", "text", text="Other customer")
    assert db.inbox(PHONE, first["ts"])["messages"] == [second]


def test_future_callback_is_durable_and_not_visible_early(db):
    db.add_event(PHONE, "incoming_callback", {"phone": PHONE}, ts="2099-01-01T00:00:00.000000Z")
    event = db.add_event(PHONE, "handoff", {"summary": "Manager"})
    assert db.inbox(PHONE)["events"] == [event]
