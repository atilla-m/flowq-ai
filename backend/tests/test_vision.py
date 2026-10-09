from copy import deepcopy
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from backend.tests.test_agent import app_with_ai
from backend.tests.test_api import PHONE, OTHER, call
from backend.vision import normalize_observation


OBSERVATION = {"model": "iPhone 13", "storage": 128, "battery_health": 79, "screen_cracked": True,
               "back_cracked": False, "other_damage": [], "confidence": .95,
               "evidence": {"screen_photo": True, "back_photo": True, "battery_screenshot": True, "about_screenshot": True},
               "reason": ""}


def test_vision_mismatches_are_computed_from_all_claims(pack):
    result = normalize_observation(OBSERVATION, {"model": "iPhone 15", "storage": 256, "battery_health": 100,
                                              "damage": "no damage"}, pack.tradein_rules)
    assert {m["field"] for m in result["mismatches"]} == {"model", "storage", "battery_health", "screen_cracked"}
    assert not result["need_retake"]


def test_missing_evidence_or_low_confidence_demands_retake(pack):
    incomplete = deepcopy(OBSERVATION)
    incomplete["evidence"]["back_photo"] = False
    assert normalize_observation(incomplete, {}, pack.tradein_rules)["need_retake"]
    assert normalize_observation({**OBSERVATION, "confidence": .2}, {}, pack.tradein_rules)["need_retake"]
    assert normalize_observation({**OBSERVATION, "battery_health": None}, {}, pack.tradein_rules)["need_retake"]


class FakeVision:
    def __init__(self, pack):
        self.pack = pack
        self.media = []

    async def analyze(self, media, claimed, pack):
        self.media = media
        return normalize_observation(OBSERVATION, claimed, pack.tradein_rules)


def upload(client, phone=PHONE):
    buffer = BytesIO()
    Image.new("RGB", (20, 20), "white").save(buffer, "PNG")
    return client.post("/api/media", data={"phone": phone}, files={"file": ("photo.png", buffer.getvalue(), "image/png")}).json()["media_id"]


def test_vision_all_photos_and_polite_mismatch_notice(tmp_path, pack):
    ai = FakeVision(pack)
    with TestClient(app_with_ai(tmp_path, ai)) as client:
        ids = [upload(client) for _ in range(4)]
        result = call(client, "analyze_device_media", {"media_ids": ids, "claimed": {"battery_health": 100, "damage": "none"}})
        assert len(ai.media) == 4 and result["analysis_id"]
        assert "photos" in result["customer_notice"]
        quote = call(client, "calculate_tradein", {"device_info": {"analysis_id": result["analysis_id"],
            "battery_health": 100, "screen_cracked": False, "powers_on": True, "water_damage": False,
            "repaired_before": False, "face_id_working": True, "icloud_signed_out": False}})
        assert quote["final_offer"] == 300
        assert call(client, "analyze_device_media", {"media_ids": ids}, phone=OTHER)["error"]


def test_empty_media_ids_uses_recent_uploads(tmp_path, pack):
    ai = FakeVision(pack)
    with TestClient(app_with_ai(tmp_path, ai)) as client:
        ids = [upload(client) for _ in range(4)]
        result = call(client, "analyze_device_media", {})
        assert result["media_ids"] == ids


def test_missing_photos_returns_retake(tmp_path, pack):
    with TestClient(app_with_ai(tmp_path, FakeVision(pack))) as client:
        assert call(client, "analyze_device_media", {})["need_retake"]
