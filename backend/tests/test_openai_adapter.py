from dataclasses import replace
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend.ai import AIClient
from backend.config import Settings
from backend.main import create_app
from backend.tests.test_api import PHONE
from backend.tests.test_vision import OBSERVATION
from backend.tools.schemas import realtime_tools, response_tools


def sdk_client():
    return SimpleNamespace(responses=SimpleNamespace(create=AsyncMock()),
        realtime=SimpleNamespace(client_secrets=SimpleNamespace(create=AsyncMock())), close=AsyncMock())


def test_realtime_ga_client_secret_payload_memory_and_key_secrecy(tmp_path):
    settings = replace(Settings(), api_key="server-secret-should-never-leak",
                       database_path=tmp_path / "voice.sqlite3", upload_dir=tmp_path / "media")
    client = sdk_client()
    client.realtime.client_secrets.create.return_value = SimpleNamespace(value="ek_ephemeral_demo")
    ai = AIClient(settings, client=client)
    with TestClient(create_app(settings, ai=ai)) as app_client:
        response = app_client.post("/api/realtime/session", json={"phone": PHONE})
        assert response.status_code == 200
        result = response.json()
        assert result["client_secret"] == "ek_ephemeral_demo"
        assert "Aysel Məmmədova" in result["instructions"]
        assert len(result["tools"]) == 14
        assert settings.api_key not in response.text
        payload = client.realtime.client_secrets.create.call_args.kwargs
        assert payload["session"]["type"] == "realtime"
        assert payload["session"]["model"] == settings.realtime_model
        assert payload["session"]["audio"]["output"]["voice"] == settings.realtime_voice
        assert payload["expires_after"]["seconds"] == 600
        assert all(tool["type"] == "function" and "function" not in tool for tool in result["tools"])


def test_missing_key_realtime_returns_503(tmp_path):
    with TestClient(create_app(replace(Settings(), database_path=tmp_path / "empty.sqlite3", upload_dir=tmp_path / "media"))) as client:
        response = client.post("/api/realtime/session", json={"phone": PHONE})
        assert response.status_code == 503 and "OPENAI_API_KEY" in response.json()["detail"]


def test_schema_names_are_identical_between_voice_and_chat():
    assert [tool["name"] for tool in realtime_tools()] == [tool["name"] for tool in response_tools()]
    assert len({tool["name"] for tool in realtime_tools()}) == 14


def test_vision_sdk_request_contains_every_image_and_env_model(tmp_path, pack):
    import asyncio
    client = sdk_client()
    client.responses.create.return_value = SimpleNamespace(output_text=json.dumps(OBSERVATION))
    settings = replace(Settings(), vision_model="configured-vision-model")
    ai = AIClient(settings, client)
    buffer = BytesIO()
    Image.new("RGB", (10, 10), "white").save(buffer, "PNG")
    media = []
    for i in range(4):
        path = tmp_path / f"image-{i}.png"
        path.write_bytes(buffer.getvalue())
        media.append({"path": str(path), "mime_type": "image/png"})
    result = asyncio.run(ai.analyze(media, {"battery_health": 100}, pack))
    payload = client.responses.create.call_args.kwargs
    assert payload["model"] == "configured-vision-model"
    assert len([item for item in payload["input"][0]["content"] if item["type"] == "input_image"]) == 4
    assert payload["text"]["format"]["strict"] is True
    assert result["mismatches"][0]["field"] == "battery_health"


def test_invalid_vision_response_never_produces_a_price(tmp_path, pack):
    import asyncio
    client = sdk_client()
    client.responses.create.return_value = SimpleNamespace(output_text="not valid JSON")
    result = asyncio.run(AIClient(Settings(), client).analyze([], {}, pack))
    assert result["need_retake"] and result["confidence"] == 0
