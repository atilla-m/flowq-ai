from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from uuid import uuid4


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def iso_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"[\s()+-]", "", phone.strip())
    if not digits.isascii() or not digits.isdigit():
        raise ValueError("Phone must contain a valid phone number")
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("0"):
        digits = "994" + digits[1:]
    elif len(digits) == 9:
        digits = "994" + digits
    if not 10 <= len(digits) <= 15:
        raise ValueError("Phone must contain 10–15 digits including country code")
    return "+" + digits


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone),
    channel TEXT NOT NULL, summary TEXT NOT NULL, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone), ts TEXT NOT NULL,
    sender TEXT NOT NULL, type TEXT NOT NULL, text TEXT, image_url TEXT, data TEXT
);
CREATE INDEX IF NOT EXISTS messages_phone_ts ON messages(phone, ts);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone), ts TEXT NOT NULL,
    type TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_phone_ts ON events(phone, ts);
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone), ts TEXT NOT NULL,
    path TEXT NOT NULL, mime_type TEXT NOT NULL, url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone), ts TEXT NOT NULL,
    media_ids TEXT NOT NULL, result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone), ts TEXT NOT NULL,
    analysis_id TEXT NOT NULL REFERENCES analyses(id), device_info TEXT NOT NULL,
    calculation TEXT NOT NULL, current_offer_cents INTEGER NOT NULL, is_final INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock (
    pack TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0),
    PRIMARY KEY(pack, sku)
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES customers(phone), ts TEXT NOT NULL,
    items TEXT NOT NULL, tradein TEXT, delivery TEXT NOT NULL, total_cents INTEGER NOT NULL,
    status TEXT NOT NULL, analysis_id TEXT UNIQUE REFERENCES analyses(id), idempotency_key TEXT,
    UNIQUE(phone, idempotency_key)
);
CREATE TABLE IF NOT EXISTS payments (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), status TEXT NOT NULL DEFAULT 'pending',
    ts TEXT NOT NULL, paid_at TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY, ts TEXT NOT NULL, phone TEXT NOT NULL REFERENCES customers(phone),
    channel TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT NOT NULL,
    latency_ms REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_calls_phone_ts ON tool_calls(phone, ts);
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def connection(self, *, write: bool = False):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=15000")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self, pack):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(SCHEMA)
        with self.connection(write=True) as connection:
            for customer in pack.customers:
                phone = normalize_phone(customer["phone"])
                connection.execute("INSERT OR IGNORE INTO customers VALUES (?, ?, ?)",
                                   (customer["id"], phone, customer["name"]))
                for i, history in enumerate(customer.get("history", [])):
                    connection.execute("INSERT OR IGNORE INTO conversations VALUES (?, ?, ?, ?, ?)",
                                       (f"seed:{pack.name}:{customer['id']}:{i}", phone,
                                        history["channel"], history["summary"], iso_timestamp(history["ts"])))
            for item in pack.catalog + pack.accessories:
                connection.execute("INSERT OR IGNORE INTO stock VALUES (?, ?, ?)",
                                   (pack.name, item["sku"], item.get("stock", 0)))

    def ensure_customer(self, phone: str) -> dict:
        phone = normalize_phone(phone)
        with self.connection(write=True) as connection:
            connection.execute("INSERT OR IGNORE INTO customers VALUES (?, ?, ?)",
                               ("cust_" + uuid4().hex, phone, ""))
            return dict(connection.execute("SELECT * FROM customers WHERE phone=?", (phone,)).fetchone())

    def customers(self) -> list[dict]:
        with self.connection() as connection:
            return [dict(row) for row in connection.execute("SELECT id, name, phone FROM customers ORDER BY id")]

    def history(self, phone: str) -> dict:
        customer = self.ensure_customer(phone)
        phone = customer["phone"]
        with self.connection() as connection:
            conversations = [dict(row) for row in connection.execute(
                "SELECT channel, summary, ts FROM conversations WHERE phone=? ORDER BY ts DESC LIMIT 12", (phone,))]
            orders = [self.order_dict(row) for row in connection.execute(
                "SELECT * FROM orders WHERE phone=? ORDER BY ts DESC LIMIT 8", (phone,))]
            recent_messages = [self.message_dict(row) for row in connection.execute(
                "SELECT * FROM messages WHERE phone=? ORDER BY ts DESC LIMIT 8", (phone,))][::-1]
            media_ids = [row[0] for row in connection.execute(
                "SELECT id FROM media WHERE phone=? ORDER BY ts DESC LIMIT 8", (phone,))][::-1]
            quotes = [self.quote_dict(row) for row in connection.execute(
                "SELECT * FROM quotes WHERE phone=? ORDER BY ts DESC LIMIT 1", (phone,))]
        return {**customer, "history_summary": "\n".join(f"{c['channel']}: {c['summary']}" for c in reversed(conversations)),
                "conversations": conversations, "past_orders": orders, "recent_messages": recent_messages,
                "recent_media_ids": media_ids, "latest_tradein_quote": quotes[0] if quotes else None}

    def add_conversation(self, phone: str, channel: str, summary: str):
        with self.connection(write=True) as connection:
            connection.execute("INSERT INTO conversations VALUES (?, ?, ?, ?, ?)",
                               (uuid4().hex, phone, channel, summary, now_iso()))

    @staticmethod
    def message_dict(row) -> dict:
        result = {"id": row["id"], "ts": row["ts"], "from": row["sender"], "type": row["type"]}
        for field in ("text", "image_url", "data"):
            if row[field] is not None:
                result[field] = json.loads(row[field]) if field == "data" else row[field]
        return result

    def add_message(self, phone: str, sender: str, kind: str, *, text=None, image_url=None, data=None,
                    connection=None) -> dict:
        message = {"id": uuid4().hex, "ts": now_iso(), "from": sender, "type": kind}
        values = (message["id"], phone, message["ts"], sender, kind, text, image_url,
                  dumps(data) if data is not None else None)
        if connection is not None:
            connection.execute("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values)
        else:
            with self.connection(write=True) as conn:
                conn.execute("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values)
        return {**message, **({"text": text} if text is not None else {}),
                **({"image_url": image_url} if image_url is not None else {}),
                **({"data": data} if data is not None else {})}

    def add_event(self, phone: str, kind: str, data: dict, *, ts=None, connection=None) -> dict:
        event = {"id": uuid4().hex, "ts": ts or now_iso(), "type": kind, "data": data}
        values = (event["id"], phone, event["ts"], kind, dumps(data))
        if connection is not None:
            connection.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?)", values)
        else:
            with self.connection(write=True) as conn:
                conn.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?)", values)
        return event

    def inbox(self, phone: str, since: str | None = None) -> dict:
        cutoff = iso_timestamp(since) if since else ""
        with self.connection() as connection:
            messages = [self.message_dict(row) for row in connection.execute(
                "SELECT * FROM messages WHERE phone=? AND ts>? ORDER BY ts, id", (phone, cutoff))]
            events = [{"id": row["id"], "ts": row["ts"], "type": row["type"], "data": json.loads(row["data"])}
                      for row in connection.execute(
                "SELECT * FROM events WHERE phone=? AND ts>? AND ts<=? ORDER BY ts, id", (phone, cutoff, now_iso()))]
        return {"messages": messages, "events": events}

    def log_tool(self, phone, channel, tool, args, result, latency_ms):
        with self.connection(write=True) as connection:
            connection.execute("INSERT INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               (uuid4().hex, now_iso(), phone, channel, tool, dumps(args), dumps(result), latency_ms))

    def trace(self, phone: str) -> list[dict]:
        with self.connection() as connection:
            return [{"ts": row["ts"], "channel": row["channel"], "tool": row["tool"],
                     "args": json.loads(row["args"]), "result": json.loads(row["result"]),
                     "latency_ms": row["latency_ms"]} for row in connection.execute(
                         "SELECT * FROM tool_calls WHERE phone=? ORDER BY ts, id", (phone,))]

    @staticmethod
    def order_dict(row) -> dict:
        return {"id": row["id"], "order_id": row["id"], "phone": row["phone"], "ts": row["ts"],
                "items": json.loads(row["items"]), "tradein": json.loads(row["tradein"]) if row["tradein"] else None,
                "delivery": json.loads(row["delivery"]), "total": row["total_cents"] / 100,
                "total_azn": row["total_cents"] / 100, "currency": "AZN", "status": row["status"]}

    def order(self, order_id: str, phone: str | None = None) -> dict:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            if row is None or (phone is not None and row["phone"] != phone):
                raise LookupError("Order not found for this customer")
            return self.order_dict(row)

    @staticmethod
    def quote_dict(row) -> dict:
        return {"quote_id": row["id"], "phone": row["phone"], "analysis_id": row["analysis_id"],
                "device_info": json.loads(row["device_info"]), **json.loads(row["calculation"]),
                "current_offer": row["current_offer_cents"] / 100, "is_final": bool(row["is_final"])}

    def mark_paid(self, order_id: str) -> dict:
        """The payment endpoint is the ONLY caller; tools never call this method."""
        with self.connection(write=True) as connection:
            order = connection.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            if order is None:
                raise LookupError("Order not found")
            payment = connection.execute("SELECT * FROM payments WHERE order_id=?", (order_id,)).fetchone()
            if payment and payment["status"] == "paid":
                return {"status": "paid"}
            ts = now_iso()
            connection.execute("INSERT INTO payments VALUES (?, 'paid', ?, ?) ON CONFLICT(order_id) "
                               "DO UPDATE SET status='paid', paid_at=excluded.paid_at", (order_id, ts, ts))
            connection.execute("UPDATE orders SET status='paid' WHERE id=?", (order_id,))
            self.add_event(order["phone"], "order_update", {"order_id": order_id, "status": "paid"}, connection=connection)
            self.add_message(order["phone"], "agent", "text", text=f"Ödəniş təsdiqləndi. Sifariş: {order_id}.",
                             data={"order_id": order_id, "status": "paid"}, connection=connection)
        return {"status": "paid"}
