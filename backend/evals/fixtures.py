import hashlib
import json
import traceback
from pathlib import Path

from backend.ai import AIClient
from backend.vision import normalize_observation

DIRECTORY = Path(__file__).resolve().parent


class FixtureVisionAI(AIClient):
    """Only the image interpretation is mocked; dispatch, mismatch logic and DB are real."""
    def __init__(self, settings, client=None):
        super().__init__(settings, client)
        self.fixtures = json.loads((DIRECTORY / "fixtures/labels.json").read_text())["devices"]
        self.hashes = {hashlib.sha256((DIRECTORY / "fixtures" / filename).read_bytes()).hexdigest(): device
                       for device, data in self.fixtures.items() for filename in data["files"]}
        self.provider_traceback = None

    async def respond(self, **kwargs):
        try:
            return await super().respond(**kwargs)
        except Exception:
            # The HTTP route deliberately returns a generic 502. Keep its chained
            # provider cause in eval diagnostics without editing production routing.
            self.provider_traceback = traceback.format_exc()
            raise

    async def analyze(self, media, claimed, pack):
        devices = {self.hashes.get(hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest()) for item in media}
        if len(devices) != 1 or None in devices or len(media) < 4:
            return {"need_retake": True, "confidence": 0, "mismatches": [],
                    "reason": "Please provide the four matching synthetic fixture views."}
        device = next(iter(devices))
        return normalize_observation(self.fixtures[device]["observation"], claimed, pack.tradein_rules)
