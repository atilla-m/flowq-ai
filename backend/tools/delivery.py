from backend.tools.common import normalize_text


def calculate_delivery(address: str, config: dict) -> dict:
    text = normalize_text(address)
    if any(normalize_text(alias) in text for alias in config["pickup_aliases"]):
        return {"address": address, "district": "pickup", "fee_azn": config["pickup_fee_azn"],
                "currency": "AZN", "needs_clarification": False}
    matches = []
    for district in config["districts"]:
        aliases = [district["name"], *district.get("aliases", [])]
        if any(f" {normalize_text(alias)} " in f" {text} " for alias in aliases):
            matches.append(district)
    if len(matches) != 1:
        return {"address": address, "fee_azn": None, "needs_clarification": True,
                "question": "Çatdırılma üçün hansı rayon və ya şəhərdir?",
                "districts": [district["name"] for district in config["districts"]]}
    district = matches[0]
    return {"address": address, "district": district["name"], "fee_azn": district["fee_azn"],
            "currency": "AZN", "needs_clarification": False}
