"""Twilio WhatsApp for the single live-demo customer.

Outbound: every agent message written to that customer's inbox (text, photo request, product card,
order summary, payment link) is also delivered to DEMO_CALLER_PHONE on WhatsApp, including the
photo request sent while a telephone call is in progress.
Inbound: signed webhook for texts and photos. Photos are stored like browser uploads, so a live
telephone call learns about them through its inbox watcher; otherwise the chat agent replies.
"""
import asyncio
from contextlib import suppress
import logging
import re
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
import httpx
from twilio.http.async_http_client import AsyncTwilioHttpClient
from twilio.rest import Client

from backend.ai import AIProviderError, AIUnavailable
from backend.db import Database, normalize_phone, now_iso
from backend.media import MediaError, save_image

logger = logging.getLogger(__name__)
MESSAGE_SID = re.compile(r"(SM|MM)[0-9a-fA-F]{32}")
EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
MAX_BODY = 1500  # WhatsApp bodies are capped at 1600 characters
MAX_PHOTOS = 8  # same limit as media_ids in a browser chat turn
APOLOGY = "Sorry, I could not process that just now. Please try again in a moment."


class WhatsAppGateway:
    def __init__(self, settings):
        self.settings = settings
        self.http = AsyncTwilioHttpClient(timeout=10, max_retries=0)
        self.client = Client(settings.twilio_account_sid, settings.twilio_auth_token, http_client=self.http)

    async def send(self, to: str, body: str) -> str:
        message = await self.client.messages.create_async(from_=self.settings.twilio_whatsapp_from, to=to, body=body)
        return message.sid

    async def fetch_media(self, url: str) -> bytes:
        """Download one inbound attachment. Twilio media needs account auth; never fetch other hosts."""
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "api.twilio.com":
            raise ValueError("Unexpected media host")
        limit = self.settings.max_upload_bytes
        auth = (self.settings.twilio_account_sid, self.settings.twilio_auth_token)
        async with httpx.AsyncClient(auth=auth, follow_redirects=True, timeout=20) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > limit:
                        raise MediaError(413, "Images must be at most 10 MB")
                return bytes(data)

    async def close(self):
        await self.http.close()


def render(message: dict) -> str | None:
    """Plain-text WhatsApp body for one inbox message; None when there is nothing to say."""
    kind, text, data = message["type"], (message.get("text") or "").strip(), message.get("data") or {}
    if kind == "product_card":
        variant = " · ".join(str(part) for part in (
            f"{data['storage']} GB" if data.get("storage") else "", data.get("color", "")) if part)
        lines = [f"*{data.get('name') or text}*" + (f" ({variant})" if variant else "")]
        if data.get("price_azn") is not None:
            lines.append(f"{data['price_azn']} AZN")
        if data.get("compatible_models"):
            lines.append("Fits: " + ", ".join(data["compatible_models"]))
        body = "\n".join(lines)
    elif kind == "payment_link":
        body = "\n".join(part for part in (text, data.get("url", "")) if part)
    elif kind == "order_summary":
        lines = ["*Order " + str(data.get("id", "")) + "*"]
        for item in data.get("items", []):
            quantity = f" ×{item['quantity']}" if item.get("quantity", 1) > 1 else ""
            lines.append(f"{item.get('name', 'Item')}{quantity}: {item.get('line_total_azn', item.get('price_azn'))} AZN")
        if data.get("tradein"):
            lines.append(f"Trade-in: −{data['tradein'].get('credit_azn')} AZN")
        delivery = data.get("delivery") or {}
        if delivery.get("fee_azn") is not None:
            lines.append(f"Delivery ({delivery.get('district', 'address')}): {delivery['fee_azn']} AZN")
        lines.append(f"*Total: {data.get('total_azn')} AZN*")
        body = "\n".join(lines)
    else:  # text, media_request
        body = text
    return body[:MAX_BODY] or None


class WhatsApp:
    def __init__(self, settings, db: Database, pack, agent, telephony, *, gateway=None):
        self.settings, self.db, self.pack, self.agent, self.telephony = settings, db, pack, agent, telephony
        self.gateway = gateway
        self.worker = None
        self.since = ""
        self.tasks: set[asyncio.Task] = set()

    @property
    def configured(self) -> bool:
        settings = self.settings
        if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_whatsapp_from
                and settings.demo_caller_phone and settings.public_base_url):
            return False
        try:
            self.telephony.base_url
            sender = settings.twilio_whatsapp_from
            if not sender.startswith("whatsapp:") or normalize_phone(sender.removeprefix("whatsapp:")) != sender[9:]:
                return False
            normalize_phone(settings.demo_caller_phone)
        except ValueError:
            return False
        return sum(bool(c.get("telephony_demo_target")) for c in self.pack.customers) == 1

    @property
    def recipient(self) -> str:
        """The demo person's real WhatsApp address."""
        return "whatsapp:" + normalize_phone(self.settings.demo_caller_phone)

    @property
    def customer_phone(self) -> str:
        """The seeded customer whose inbox is mirrored to that WhatsApp address."""
        return normalize_phone(next(c for c in self.pack.customers if c.get("telephony_demo_target"))["phone"])

    async def start(self):
        if not self.configured:
            return
        self.gateway = self.gateway or WhatsAppGateway(self.settings)
        # Only messages written from now on are delivered; history is never replayed to a real phone.
        self.since = now_iso()
        with self.db.connection(write=True) as conn:
            # A send interrupted by a crash has an unknown outcome; never resend it automatically.
            conn.execute("UPDATE whatsapp_outbox SET status='failed', error='interrupted' WHERE status='sending'")
        self.worker = asyncio.create_task(self.deliver_forever(), name="twilio-whatsapp")

    async def close(self):
        for task in [self.worker, *self.tasks]:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        if self.gateway and hasattr(self.gateway, "close"):
            await self.gateway.close()

    async def deliver_forever(self):
        while True:
            try:
                await self.deliver_pending()
            except Exception:
                logger.warning("WhatsApp delivery worker unavailable")
            await asyncio.sleep(0.5)

    async def deliver_pending(self):
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT m.* FROM messages m LEFT JOIN whatsapp_outbox o ON o.message_id=m.id "
                "WHERE m.phone=? AND m.sender='agent' AND m.ts>? AND o.message_id IS NULL ORDER BY m.ts, m.id LIMIT 10",
                (self.customer_phone, self.since)).fetchall()
        for row in rows:
            message = self.db.message_dict(row)
            body = render(message)
            with self.db.connection(write=True) as conn:
                # Claim before the network call: one message is sent at most once, even across restarts.
                claimed = conn.execute("INSERT OR IGNORE INTO whatsapp_outbox VALUES (?,?,?,NULL,NULL)",
                                       (message["id"], now_iso(), "sending" if body else "skipped")).rowcount
            if not claimed or not body:
                continue
            try:
                sid, error = await self.gateway.send(self.recipient, body), None
            except asyncio.CancelledError:
                raise
            except Exception as failure:
                # Provider exceptions can carry credentials or URLs; keep only Twilio's numeric code.
                sid, error = None, f"twilio_error_{getattr(failure, 'code', None) or 'unknown'}"
                logger.warning("WhatsApp send failed (%s)", error)
            with self.db.connection(write=True) as conn:
                conn.execute("UPDATE whatsapp_outbox SET status=?, twilio_sid=?, error=? WHERE message_id=?",
                             ("failed" if error else "sent", sid, error, message["id"]))

    def on_phone_call(self) -> bool:
        return any(bridge.phone == self.customer_phone for bridge in self.telephony.bridges.values())

    async def receive(self, text: str, media_urls: list[str]):
        phone = self.customer_phone
        self.db.ensure_customer(phone)
        media_ids, rejected = [], 0
        for url in media_urls:
            try:
                media_ids.append(save_image(self.db, self.settings, phone, await self.gateway.fetch_media(url))["media_id"])
            except asyncio.CancelledError:
                raise
            except Exception:
                rejected += 1
        if rejected:
            logger.warning("WhatsApp photo rejected or not downloadable (%d)", rejected)
            self.db.add_message(phone, "agent", "text",
                                text="I could not open one of your photos. Please send it again as a normal photo.")
        if not text and not media_ids:
            return
        # Photos sent during a telephone call belong to that call: the voice agent is told about
        # them by the bridge's inbox watcher, so a second (chat) agent must not answer in parallel.
        if not text and self.on_phone_call():
            return
        try:
            await self.agent.turn(phone, text, media_ids)
        except asyncio.CancelledError:
            raise
        except Exception as failure:
            # Tell the customer something went wrong instead of leaving their message unanswered.
            expected = isinstance(failure, (AIUnavailable, AIProviderError, ValueError))
            logger.warning("WhatsApp chat turn failed (%s)", type(failure).__name__ if expected else "unexpected error")
            self.db.add_message(phone, "agent", "text", text=APOLOGY)

    def router(self):
        router = APIRouter()

        @router.post("/api/twilio/whatsapp")
        async def whatsapp(request: Request):
            if not self.configured:
                raise HTTPException(503, "Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, "
                                         "DEMO_CALLER_PHONE and PUBLIC_BASE_URL")
            form = await request.form(max_files=0, max_fields=100)
            # Sign against the configured public origin, never the tunnel's internal Host/scheme.
            url = self.telephony.base_url + request.url.path
            if request.url.query:
                url += "?" + request.url.query
            if not self.telephony.validate_signature(url, form, request.headers.get("x-twilio-signature", "")):
                raise HTTPException(403, "Invalid Twilio signature")
            if form.get("AccountSid") != self.settings.twilio_account_sid:
                raise HTTPException(403, "Unexpected Twilio account")
            message_sid = str(form.get("MessageSid", ""))
            if not MESSAGE_SID.fullmatch(message_sid):
                raise HTTPException(422, "Invalid MessageSid")
            reply = Response(EMPTY_TWIML, media_type="application/xml")
            # This demo line serves one registered person; anyone else in the sandbox is ignored.
            if str(form.get("From", "")) != self.recipient or not self.gateway:
                return reply
            with self.db.connection(write=True) as conn:
                fresh = conn.execute("INSERT OR IGNORE INTO whatsapp_inbound VALUES (?,?)", (message_sid, now_iso())).rowcount
            if not fresh:  # Twilio retries webhooks; handle each message once.
                return reply
            try:
                count = min(int(str(form.get("NumMedia", "0"))), MAX_PHOTOS)
            except ValueError:
                count = 0
            media_urls = [str(form[f"MediaUrl{i}"]) for i in range(count) if form.get(f"MediaUrl{i}")]
            text = str(form.get("Body", "")).strip()[:10000]
            # Answer Twilio at once; the model turn can take longer than its webhook timeout.
            task = asyncio.create_task(self.receive(text, media_urls), name="whatsapp-inbound")
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
            return reply

        return router
