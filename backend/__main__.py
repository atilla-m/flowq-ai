"""One-command backend start, including platforms that assign PORT at runtime."""
import os
from pathlib import Path

from dotenv import load_dotenv
import uvicorn


if __name__ == "__main__":
    load_dotenv(Path(__file__).with_name(".env"))
    port = int(os.getenv("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port)
