from contextlib import asynccontextmanager
from io import BytesIO
import logging
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator

from backend.ai import AIClient, AIProviderError, AIUnavailable
from backend.agent import ChatAgent, memory_instructions
from backend.config import Settings
from backend.db import Database, normalize_phone, now_iso
from backend.pack import IndustryPack
from backend.tools.service import ToolService
from backend.tools.schemas import realtime_tools


class PhoneBody(BaseModel):
    phone: str = Field(min_length=8, max_length=40)

    @field_validator("phone")
    @classmethod
    def normalized(cls, value):
        return normalize_phone(value)


class ToolBody(PhoneBody):
    channel: Literal["voice", "whatsapp"]
    args: dict[str, Any] = Field(default_factory=dict)


class ChatBody(PhoneBody):
    text: str = Field(max_length=10000)
    media_ids: list[str] = Field(default_factory=list, max_length=8)


class CallEndBody(PhoneBody):
    transcript: str = Field(max_length=100000)


def checked_phone(value: str) -> str:
    try:
        return normalize_phone(value)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def create_app(settings: Settings | None = None, ai=None) -> FastAPI:
    settings = settings or Settings.from_env()
    pack = IndustryPack.load(settings.industry_pack)
    db = Database(settings.database_path)
    ai = ai if ai is not None else AIClient(settings)
    tools = ToolService(db, pack, settings, ai)
    agent = ChatAgent(db, tools, pack, ai)

    @asynccontextmanager
    async def lifespan(app):
        db.initialize(pack)
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        yield
        if hasattr(ai, "close"):
            await ai.close()

    app = FastAPI(title="FlowQ AI", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.state.settings, app.state.pack, app.state.db, app.state.tools, app.state.ai = settings, pack, db, tools, ai
    app.state.agent = agent

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/customers")
    def customers():
        return db.customers()

    @app.get("/api/customers/by-phone/{phone}")
    def customer(phone: str):
        result = db.history(checked_phone(phone))
        return {key: result[key] for key in ("id", "name", "phone", "history_summary")}

    @app.post("/api/tools/{tool_name}")
    async def execute_tool(tool_name: str, body: ToolBody):
        return {"result": await tools.execute(tool_name, body.phone, body.channel, body.args)}

    @app.post("/api/chat")
    async def chat(body: ChatBody):
        try:
            return await agent.turn(body.phone, body.text, body.media_ids)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        except AIUnavailable as error:
            raise HTTPException(503, str(error)) from error
        except AIProviderError as error:
            raise HTTPException(502, str(error)) from error

    @app.post("/api/realtime/session")
    async def realtime_session(body: PhoneBody):
        instructions = memory_instructions(pack.voice_prompt, db.history(body.phone))
        try:
            return await ai.realtime_session(instructions, realtime_tools())
        except AIUnavailable as error:
            raise HTTPException(503, str(error)) from error
        except AIProviderError as error:
            raise HTTPException(502, str(error)) from error

    @app.post("/api/call/end")
    async def call_end(body: CallEndBody):
        return await agent.end_call(body.phone, body.transcript)

    @app.get("/api/inbox")
    def inbox(phone: str, since: str | None = None):
        try:
            return db.inbox(checked_phone(phone), since)
        except ValueError as error:
            raise HTTPException(422, "since must be an ISO timestamp") from error

    @app.get("/api/trace")
    def trace(phone: str):
        return db.trace(checked_phone(phone))

    @app.get("/api/orders/{order_id}")
    def order(order_id: str):
        try:
            return db.order(order_id)
        except LookupError as error:
            raise HTTPException(404, str(error)) from error

    @app.post("/api/payments/{order_id}/pay")
    def pay(order_id: str):
        try:
            return db.mark_paid(order_id)
        except LookupError as error:
            raise HTTPException(404, str(error)) from error

    @app.post("/api/media")
    async def media(file: UploadFile = File(...), phone: str = Form(...)):
        phone = db.ensure_customer(checked_phone(phone))["phone"]
        data = await file.read(settings.max_upload_bytes + 1)
        await file.close()
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, "Images must be at most 10 MB")
        try:
            with Image.open(BytesIO(data)) as uploaded:
                image_format = uploaded.format
                if uploaded.width * uploaded.height > 30_000_000:
                    raise HTTPException(413, "Image dimensions are too large")
                uploaded.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise HTTPException(415, "Upload a valid JPEG, PNG or WebP image") from error
        formats = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}
        if image_format not in formats:
            raise HTTPException(415, "Upload a JPEG, PNG or WebP image")
        suffix, mime_type = formats[image_format]
        media_id = "media_" + uuid4().hex
        path = settings.upload_dir / (media_id + suffix)
        path.write_bytes(data)
        url = f"{settings.backend_url}/api/media/{media_id}"
        with db.connection(write=True) as connection:
            connection.execute("INSERT INTO media VALUES (?, ?, ?, ?, ?, ?)",
                               (media_id, phone, now_iso(), str(path.resolve()), mime_type, url))
            db.add_message(phone, "customer", "image", image_url=url,
                           data={"media_id": media_id}, connection=connection)
        return {"media_id": media_id, "url": url}

    @app.get("/api/media/{media_id}")
    def uploaded_media(media_id: str):
        with db.connection() as connection:
            row = connection.execute("SELECT path, mime_type FROM media WHERE id=?", (media_id,)).fetchone()
        if not row or not Path(row["path"]).is_file():
            raise HTTPException(404, "Media not found")
        return FileResponse(row["path"], media_type=row["mime_type"])

    @app.get("/api/assets/accessories/{filename}")
    def accessory_image(filename: str):
        valid = {f"{item['sku']}.svg" for item in pack.accessories}
        if filename not in valid:
            raise HTTPException(404, "Accessory image not found")
        return FileResponse(pack.directory / "assets" / filename, media_type="image/svg+xml")

    return app


app = create_app()
