from dataclasses import replace

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


def test_cors_origins_from_environment(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://shop.example, http://localhost:5173/ ")
    settings = Settings.from_env()
    assert settings.allowed_origins == ("https://shop.example", "http://localhost:5173")


def test_configured_origin_is_allowed(tmp_path):
    settings = replace(Settings(), database_path=tmp_path / "cors.sqlite3", upload_dir=tmp_path / "media",
                       allowed_origins=("https://shop.example",))
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health", headers={"Origin": "https://shop.example"})
        assert response.headers["access-control-allow-origin"] == "https://shop.example"
        denied = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert "access-control-allow-origin" not in denied.headers


def test_english_prompt_and_pack_messages(pack):
    assert "English by default" in pack.voice_prompt
    assert "Default to English" in pack.whatsapp_prompt
    assert "One second, let me check that for you" in pack.voice_prompt
    assert pack.tradein_rules["media_instructions"].startswith("Please upload")
    assert pack.tradein_rules["deductions"][0]["reason"] == "Cracked screen"
