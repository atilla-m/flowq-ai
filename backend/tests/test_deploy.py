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


def test_built_frontend_is_served_from_the_same_origin(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>FlowQ app</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("outside")
    settings = replace(Settings(), database_path=tmp_path / "s.sqlite3", upload_dir=tmp_path / "media", frontend_dist=dist)
    with TestClient(create_app(settings)) as client:
        assert "FlowQ app" in client.get("/").text
        assert "FlowQ app" in client.get("/pay/FQ-123").text  # SPA route
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/api/health").json() == {"ok": True}  # API still wins
        assert client.get("/api/nope").status_code == 404
        assert "outside" not in client.get("/%2e%2e/secret.txt").text


def test_frontend_is_not_served_unless_configured(tmp_path):
    settings = replace(Settings(), database_path=tmp_path / "s.sqlite3", upload_dir=tmp_path / "media")
    with TestClient(create_app(settings)) as client:
        assert client.get("/").status_code == 404


def test_voice_sessions_are_capped_per_visitor(tmp_path):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    ai = SimpleNamespace(realtime_session=AsyncMock(return_value={"client_secret": "ek_x"}), close=AsyncMock())
    settings = replace(Settings(), database_path=tmp_path / "s.sqlite3", upload_dir=tmp_path / "media",
                       voice_sessions_per_ip_hour=3)
    with TestClient(create_app(settings, ai)) as client:
        start = lambda ip: client.post("/api/realtime/session", json={"phone": "+994501234567"},
                                       headers={"CF-Connecting-IP": ip}).status_code
        assert [start("203.0.113.5") for _ in range(4)] == [200, 200, 200, 429]
        assert start("203.0.113.6") == 200  # another visitor is unaffected
        assert [start("127.0.0.1") for _ in range(5)] == [200] * 5  # local operator is not capped
    assert ai.realtime_session.await_count == 9
