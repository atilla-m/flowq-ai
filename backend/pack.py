"""Load industry data; business numbers and domain-specific instructions live in packs."""
from dataclasses import dataclass
import json
from pathlib import Path
import re

from backend.config import ROOT


@dataclass(frozen=True)
class IndustryPack:
    name: str
    directory: Path
    catalog: list[dict]
    accessories: list[dict]
    tradein_rules: dict
    negotiation: dict
    delivery: dict
    customers: list[dict]
    policy: dict
    voice_prompt: str
    whatsapp_prompt: str

    @classmethod
    def load(cls, name: str, root: Path | None = None) -> "IndustryPack":
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
            raise ValueError("Invalid INDUSTRY_PACK name")
        directory = (root or ROOT / "industry_packs") / name

        def read(filename: str):
            return json.loads((directory / filename).read_text(encoding="utf-8"))

        return cls(
            name=name, directory=directory, catalog=read("catalog.json"),
            accessories=read("accessories.json"), tradein_rules=read("tradein_rules.json"),
            negotiation=read("negotiation.json"), delivery=read("delivery.json"),
            customers=read("customers.json"), policy=read("policy.json"),
            voice_prompt=(directory / "prompts/voice_system.md").read_text(encoding="utf-8"),
            whatsapp_prompt=(directory / "prompts/whatsapp_system.md").read_text(encoding="utf-8"),
        )
