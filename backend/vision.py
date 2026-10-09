"""Validate model observations and compare claims outside the LLM."""
from pydantic import BaseModel, ConfigDict, Field

from backend.tools.common import normalize_model, normalize_text


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    screen_photo: bool
    back_photo: bool
    battery_screenshot: bool
    about_screenshot: bool


class DeviceObservation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    model: str | None
    storage: int | None
    battery_health: int | None = Field(ge=0, le=100)
    screen_cracked: bool | None
    back_cracked: bool | None
    other_damage: list[str]
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    evidence: Evidence
    reason: str


def canonical_model(value: str, rules: dict) -> str:
    normalized = normalize_model(value)
    for model in rules["base_values"]:
        aliases = [model, *rules.get("model_aliases", {}).get(model, [])]
        if any(normalize_model(alias) == normalized for alias in aliases):
            return model
    return value


def normalize_observation(observation: dict, claimed: dict, rules: dict) -> dict:
    observation = DeviceObservation.model_validate(observation).model_dump()
    if observation["model"]:
        observation["model"] = canonical_model(observation["model"], rules)
    missing = [field for field in rules["required_visual_fields"] if observation[field] is None]
    missing_evidence = [field for field, present in observation["evidence"].items() if not present]
    unknown_model = observation["model"] not in rules["base_values"]
    need_retake = bool(missing or missing_evidence or unknown_model or observation["confidence"] < rules["minimum_vision_confidence"])
    if missing or missing_evidence:
        observation["confidence"] = min(observation["confidence"], .49)
    if need_retake and not observation["reason"]:
        observation["reason"] = rules["media_instructions"]
    comparisons = {key: claimed[key] for key in ("model", "storage", "battery_health", "screen_cracked", "back_cracked") if key in claimed}
    damage = claimed.get("damage")
    if isinstance(damage, dict):
        comparisons.update(damage)
    elif isinstance(damage, (str, list)):
        claims = [damage] if isinstance(damage, str) else damage
        normalized = {normalize_text(item) for item in claims}
        if any(normalize_text(alias) in normalized for alias in rules.get("undamaged_claims", [])):
            comparisons.update(screen_cracked=False, back_cracked=False)
        for field, aliases in rules.get("damage_claims", {}).items():
            if any(normalize_text(alias) in normalized for alias in aliases):
                comparisons[field] = True
    mismatches = []
    for field, claim in comparisons.items():
        observed = observation.get(field)
        if observed is None:
            continue
        comparable_claim = canonical_model(str(claim), rules) if field == "model" else claim
        if comparable_claim != observed:
            label = rules.get("field_labels", {}).get(field, field)

            def readable(value):
                if isinstance(value, bool):
                    return "yes" if value else "no"
                return str(value)

            mismatches.append({"field": field, "claimed": claim, "observed": observed,
                "message": f"{label}: you reported {readable(claim)}; the photos show {readable(observed)}"})
    return {**observation, "mismatches": mismatches, "need_retake": need_retake}
