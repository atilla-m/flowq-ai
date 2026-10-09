"""Bind tools to a customer, persist side effects, and enforce trusted pricing state."""
import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import logging
import math
import time
from uuid import uuid4

from jsonschema import Draft202012Validator, ValidationError

from backend.ai import AIProviderError, AIUnavailable
from backend.db import Database, dumps, normalize_phone, now_iso
from backend.tools.common import cents, normalize_text
from backend.tools.delivery import calculate_delivery
from backend.tools.inventory import get_accessories, search_inventory
from backend.tools.negotiation import negotiate_offer
from backend.tools.schemas import SCHEMAS
from backend.tools.tradein import calculate_tradein

logger = logging.getLogger(__name__)


def loggable(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: loggable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [loggable(item) for item in value]
    return value


class ToolService:
    def __init__(self, db: Database, pack, settings, ai=None):
        self.db, self.pack, self.settings, self.ai = db, pack, settings, ai
        self.locks: dict[str, asyncio.Lock] = {}

    async def execute(self, name: str, phone: str, channel: str, args: dict) -> dict:
        phone = self.db.ensure_customer(phone)["phone"]
        started = time.perf_counter()
        async with self.locks.setdefault(phone, asyncio.Lock()):
            try:
                if name not in SCHEMAS:
                    raise LookupError("Unknown tool")
                Draft202012Validator(SCHEMAS[name]["parameters"]).validate(args)
                dumps(args)  # Reject NaN/infinity even if a JSON parser accepted them.
                if args.get("phone") and normalize_phone(args["phone"]) != phone:
                    raise ValueError("Tools are bound to the current customer phone")
                bound = {key: value for key, value in args.items() if key != "phone"}
                result = getattr(self, name)(phone=phone, channel=channel, **bound)
                if hasattr(result, "__await__"):
                    result = await result
            except ValidationError as error:
                result = {"error": "invalid_arguments", "message": error.message}
            except (ValueError, LookupError) as error:
                result = {"error": "invalid_request", "message": str(error)}
            except AIUnavailable as error:
                result = {"error": "ai_not_configured", "message": str(error)}
            except AIProviderError as error:
                result = {"error": "provider_error", "message": str(error)}
            except Exception:
                logger.exception("Tool failed: %s", name)
                result = {"error": "tool_unavailable", "message": "This action is temporarily unavailable. Please try again or speak with a shop assistant."}
            elapsed = round((time.perf_counter() - started) * 1000, 3)
            self.db.log_tool(phone, channel, name, loggable(args), result, elapsed)
            return result

    def _items(self, kind: str) -> list[dict]:
        source = self.pack.catalog if kind == "phone" else self.pack.accessories
        with self.db.connection() as connection:
            stock = {row["sku"]: row["quantity"] for row in connection.execute(
                "SELECT sku, quantity FROM stock WHERE pack=?", (self.pack.name,))}
        items = [{**item, "stock": stock.get(item["sku"], 0), "kind": kind} for item in source]
        for item in items:
            if kind == "accessory":
                item["image_url"] = f"{self.settings.backend_url}/api/assets/accessories/{item['sku']}.svg"
        return items

    def _cards(self, phone, channel, items):
        if channel == "whatsapp":
            for item in items[:2]:
                self.db.add_message(phone, "agent", "product_card", text=item["name"],
                                    image_url=item.get("image_url"), data={**item, "currency": "AZN"})

    def get_customer_history(self, *, phone, channel):
        return self.db.history(phone)

    def search_inventory(self, *, phone, channel, query):
        result = search_inventory(query, self._items("phone"))
        self._cards(phone, channel, result["items"])
        return result

    def request_media_whatsapp(self, *, phone, channel, what=""):
        instructions = self.pack.tradein_rules["media_instructions"]
        text = f"{what}\n{instructions}" if what else instructions
        message = self.db.add_message(phone, "agent", "media_request", text=text,
                                      data={"what": what, "instructions": instructions})
        return {"sent": True, "message_id": message["id"], "instructions": text, "channel": "whatsapp"}

    async def analyze_device_media(self, *, phone, channel, media_ids=None, claimed=None):
        media_ids, claimed = media_ids or [], claimed or {}
        with self.db.connection() as connection:
            if not media_ids:
                media_ids = [row["id"] for row in connection.execute(
                    "SELECT id FROM media WHERE phone=? ORDER BY ts DESC LIMIT 4", (phone,))][::-1]
            media = []
            for media_id in dict.fromkeys(media_ids):
                row = connection.execute("SELECT * FROM media WHERE id=? AND phone=?", (media_id, phone)).fetchone()
                if not row:
                    raise ValueError("Media not found for this customer")
                media.append(dict(row))
        if not media:
            return {"need_retake": True, "reason": self.pack.tradein_rules["media_instructions"], "confidence": 0,
                    "mismatches": []}
        if self.ai is None:
            return {"error": "ai_not_configured", "message": "OPENAI_API_KEY is required for photo verification"}
        result = await self.ai.analyze(media, claimed, self.pack)
        analysis_id = "analysis_" + uuid4().hex
        result = {**result, "analysis_id": analysis_id, "media_ids": [item["id"] for item in media]}
        with self.db.connection(write=True) as connection:
            connection.execute("INSERT INTO analyses VALUES (?, ?, ?, ?, ?)",
                               (analysis_id, phone, now_iso(), dumps(result["media_ids"]), dumps(result)))
        if result.get("mismatches"):
            details = "; ".join(item["message"] for item in result["mismatches"])
            notice = f"The photos differ from some of the details you provided: {details}. We will base the offer on the condition shown in the photos."
            result["customer_notice"] = notice
            self.db.add_message(phone, "agent", "text", text=notice,
                                data={"analysis_id": analysis_id, "mismatches": result["mismatches"]})
        return result

    def calculate_tradein(self, *, phone, channel, device_info):
        with self.db.connection(write=True) as connection:
            analysis_id = device_info.get("analysis_id")
            row = connection.execute("SELECT * FROM analyses WHERE phone=? " +
                ("AND id=?" if analysis_id else "ORDER BY ts DESC LIMIT 1"),
                (phone, analysis_id) if analysis_id else (phone,)).fetchone()
            if not row:
                return {"need_retake": True, "reason": "Please verify the photos before calculating a trade-in offer."}
            observation = json.loads(row["result"])
            if observation.get("need_retake") or observation.get("confidence", 0) < self.pack.tradein_rules["minimum_vision_confidence"]:
                return {"need_retake": True, "reason": observation.get("reason", "Please send clearer photos.")}
            required = self.pack.tradein_rules["required_visual_fields"]
            if any(observation.get(field) is None for field in required):
                return {"need_retake": True, "reason": self.pack.tradein_rules["media_instructions"]}
            missing = [field for field in self.pack.tradein_rules["checklist_fields"] if field not in device_info]
            # Alternate polarity is allowed but never double-counted.
            if "face_id_working" in missing and "face_id_broken" in device_info:
                missing.remove("face_id_working")
            if "powers_on" in missing and "does_not_power_on" in device_info:
                missing.remove("powers_on")
            if missing:
                return {"needs_clarification": True, "missing_fields": missing,
                        "message": "Please complete the short condition checklist before we calculate the offer."}
            verified = {field: observation[field] for field in required}
            # Verified photo facts win even when an LLM submits contradictory device_info.
            verified.update({field: device_info[field] for field in self.pack.tradein_rules["checklist_fields"] if field in device_info})
            verified["face_id_broken"] = not device_info["face_id_working"] if "face_id_working" in device_info else device_info["face_id_broken"]
            verified["does_not_power_on"] = not device_info["powers_on"] if "powers_on" in device_info else device_info["does_not_power_on"]
            calculation = calculate_tradein(verified, self.pack.tradein_rules)
            existing = connection.execute("SELECT * FROM quotes WHERE phone=? AND analysis_id=? AND device_info=? "
                                          "ORDER BY ts DESC LIMIT 1", (phone, row["id"], dumps(verified))).fetchone()
            if existing:
                return self.db.quote_dict(existing)
            quote_id = "quote_" + uuid4().hex
            connection.execute("INSERT INTO quotes VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                (quote_id, phone, now_iso(), row["id"], dumps(verified), dumps(calculation), cents(calculation["final_offer"])))
            result = {**calculation, "quote_id": quote_id, "analysis_id": row["id"],
                      "current_offer": calculation["final_offer"], "is_final": False,
                      "mismatches": observation.get("mismatches", [])}
        return result

    def _quote_row(self, connection, phone, quote_id=None):
        row = connection.execute("SELECT * FROM quotes WHERE phone=? " +
            ("AND id=?" if quote_id else "ORDER BY ts DESC LIMIT 1"),
            (phone, quote_id) if quote_id else (phone,)).fetchone()
        if not row:
            raise ValueError("First obtain a verified calculate_tradein quote")
        return row

    def negotiate_offer(self, *, phone, channel, customer_ask, quote_id=None, base_offer=None, current_offer=None):
        with self.db.connection(write=True) as connection:
            row = self._quote_row(connection, phone, quote_id)
            calculation = json.loads(row["calculation"])
            # Arguments base_offer/current_offer are accepted for the contract but never trusted.
            result = negotiate_offer(calculation["final_offer"], row["current_offer_cents"] / 100,
                                     customer_ask, self.pack.negotiation)
            used = connection.execute("SELECT id FROM orders WHERE analysis_id=?", (row["analysis_id"],)).fetchone()
            if used:
                raise ValueError("This trade-in is already attached to an order")
            connection.execute("UPDATE quotes SET current_offer_cents=?, is_final=? WHERE id=?",
                               (cents(result["new_offer"]), int(result["is_final"]), row["id"]))
        return {**result, "quote_id": row["id"]}

    def get_accessories(self, *, phone, channel, phone_model):
        result = get_accessories(phone_model, self._items("accessory"))
        self._cards(phone, channel, result["items"])
        return result

    def calculate_delivery(self, *, phone, channel, address):
        return calculate_delivery(address, self.pack.delivery)

    def create_order(self, *, phone, channel, items, address, tradein_quote_id=None, idempotency_key=None):
        delivery = calculate_delivery(address, self.pack.delivery)
        if delivery["needs_clarification"]:
            return delivery
        inventory = {item["sku"]: {**item, "kind": "phone"} for item in self.pack.catalog}
        inventory.update({item["sku"]: {**item, "kind": "accessory"} for item in self.pack.accessories})
        quantities = Counter()
        for item in items:
            if item["sku"] not in inventory:
                raise ValueError(f"Unknown catalog SKU: {item['sku']}")
            quantities[item["sku"]] += item.get("quantity", 1)
        phone_models = {inventory[sku]["name"] for sku in quantities if inventory[sku]["kind"] == "phone"}
        for sku in quantities:
            item = inventory[sku]
            if item["kind"] == "accessory" and not any(model in item["compatible_models"] for model in phone_models):
                raise ValueError(f"Accessory {sku} does not match the exact phone model in this order")
        with self.db.connection(write=True) as connection:
            if idempotency_key:
                existing = connection.execute("SELECT * FROM orders WHERE phone=? AND idempotency_key=?",
                                              (phone, idempotency_key)).fetchone()
                if existing:
                    return self.db.order_dict(existing)
            order_items = []
            subtotal = 0
            for sku, quantity in quantities.items():
                item = inventory[sku]
                available = connection.execute("SELECT quantity FROM stock WHERE pack=? AND sku=?",
                                               (self.pack.name, sku)).fetchone()
                if not available or available["quantity"] < quantity:
                    raise ValueError(f"Not enough stock for {sku}")
                line_total = cents(item["price_azn"]) * quantity
                subtotal += line_total
                order_items.append({"sku": sku, "name": item["name"], "kind": item["kind"], "quantity": quantity,
                                    "price_azn": item["price_azn"], "line_total_azn": line_total / 100,
                                    **({"storage": item["storage"], "color": item["color"]} if item["kind"] == "phone" else {})})
            tradein, analysis_id, credit = None, None, 0
            if tradein_quote_id:
                row = self._quote_row(connection, phone, tradein_quote_id)
                analysis_id = row["analysis_id"]
                if connection.execute("SELECT id FROM orders WHERE analysis_id=?", (analysis_id,)).fetchone():
                    raise ValueError("This verified trade-in device is already used in an order")
                quote = self.db.quote_dict(row)
                cap = negotiate_offer(quote["final_offer"], quote["current_offer"], 0, self.pack.negotiation)
                credit = min(row["current_offer_cents"], cents(cap["max_offer"]))
                tradein = {**quote, "offer": credit / 100, "credit_azn": credit / 100}
            total = subtotal - credit + cents(delivery["fee_azn"])
            if total < 0:
                raise ValueError("Trade-in exceeds this purchase; ask a human about cash trade-in")
            order_id, ts = "FQ-" + uuid4().hex[:12].upper(), now_iso()
            for sku, quantity in quantities.items():
                connection.execute("UPDATE stock SET quantity=quantity-? WHERE pack=? AND sku=?",
                                   (quantity, self.pack.name, sku))
            connection.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (order_id, phone, ts, dumps(order_items), dumps(tradein) if tradein else None,
                                dumps(delivery), total, "awaiting_payment", analysis_id, idempotency_key))
            connection.execute("INSERT INTO payments VALUES (?, 'pending', ?, NULL)", (order_id, ts))
            order = self.db.order_dict(connection.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone())
            self.db.add_message(phone, "agent", "order_summary", text=f"Order {order_id}: total {total / 100:.2f} AZN.",
                                data=order, connection=connection)
            self.db.add_event(phone, "order_update", {"order_id": order_id, "status": "awaiting_payment"}, connection=connection)
        return order

    def create_payment_link(self, *, phone, channel, order_id):
        self.db.order(order_id, phone)
        status = self.check_payment_status(phone=phone, channel=channel, order_id=order_id)
        if status["status"] == "paid":
            return {"order_id": order_id, "status": "paid", "message": "This order has already been paid."}
        url = f"{self.settings.frontend_url}/pay/{order_id}"
        self.db.add_message(phone, "agent", "payment_link", text="Your payment link:",
                            data={"order_id": order_id, "url": url, "status": "pending"})
        return {"order_id": order_id, "url": url, "status": "pending"}

    def check_payment_status(self, *, phone, channel, order_id):
        order = self.db.order(order_id, phone)
        with self.db.connection() as connection:
            row = connection.execute("SELECT status, paid_at FROM payments WHERE order_id=?", (order_id,)).fetchone()
        return {"order_id": order_id, "status": row["status"] if row else "pending",
                "paid_at": row["paid_at"] if row else None, "total_azn": order["total"]}

    def get_order_status(self, *, phone, channel, order_id=None):
        if order_id:
            return self.db.order(order_id, phone)
        with self.db.connection() as connection:
            return {"orders": [self.db.order_dict(row) for row in connection.execute(
                "SELECT * FROM orders WHERE phone=? ORDER BY ts DESC LIMIT 10", (phone,))]}

    def schedule_callback(self, *, phone, channel, delay_seconds=15):
        ts = (datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)).isoformat(timespec="microseconds").replace("+00:00", "Z")
        event = self.db.add_event(phone, "incoming_callback", {"phone": phone, "delay_seconds": delay_seconds,
            "scheduled_at": ts, "name": self.db.history(phone)["name"]}, ts=ts)
        return {"scheduled": True, "event_id": event["id"], "scheduled_at": ts, "delay_seconds": delay_seconds}

    def handoff_to_human(self, *, phone, channel, summary):
        event = self.db.add_event(phone, "handoff", {"phone": phone, "summary": summary, "channel": channel})
        self.db.add_message(phone, "agent", "text", text="I am connecting you with a shop assistant.", data={"event_id": event["id"]})
        return {"handed_off": True, "event_id": event["id"]}
