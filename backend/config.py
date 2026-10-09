from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")


def rooted_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


@dataclass(frozen=True)
class Settings:
    api_key: str = ""
    chat_model: str = "gpt-6.1-sol"
    vision_model: str = "gpt-6.1-sol"
    realtime_model: str = "gpt-realtime-2.1"
    realtime_voice: str = "marin"
    transcription_model: str = "gpt-live-transcribe"
    industry_pack: str = "gadgets"
    database_path: Path = ROOT / "backend/data/flowq.sqlite3"
    upload_dir: Path = ROOT / "backend/data/media"
    backend_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:5173"
    max_upload_bytes: int = 10 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_key=os.getenv("OPENAI_API_KEY", ""),
            chat_model=os.getenv("CHAT_MODEL", cls.chat_model),
            vision_model=os.getenv("VISION_MODEL", cls.vision_model),
            realtime_model=os.getenv("REALTIME_MODEL", cls.realtime_model),
            realtime_voice=os.getenv("REALTIME_VOICE", cls.realtime_voice),
            transcription_model=os.getenv("TRANSCRIPTION_MODEL", cls.transcription_model),
            industry_pack=os.getenv("INDUSTRY_PACK", cls.industry_pack),
            database_path=rooted_path(os.getenv("DATABASE_PATH", "backend/data/flowq.sqlite3")),
            upload_dir=rooted_path(os.getenv("UPLOAD_DIR", "backend/data/media")),
            backend_url=os.getenv("BACKEND_PUBLIC_URL", cls.backend_url).rstrip("/"),
            frontend_url=os.getenv("FRONTEND_URL", cls.frontend_url).rstrip("/"),
        )
