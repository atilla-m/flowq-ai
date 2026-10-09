from backend.tools.common import money, normalize_text


def calculate_tradein(device_info: dict, rules: dict) -> dict:
    """Pure, deterministic valuation. The service supplies photo-verified facts."""
    requested = normalize_text(str(device_info.get("model", "")))
    model = next((name for name in rules["base_values"] if normalize_text(name) == requested), None)
    if not model:
        raise ValueError("This model is not in the trade-in rules; ask a human")
    storage = device_info.get("storage")
    base = rules["base_values"][model].get(str(storage))
    if base is None:
        raise ValueError("This storage variant is not in the trade-in rules")
    battery = device_info.get("battery_health")
    if isinstance(battery, bool) or not isinstance(battery, (int, float)) or not 0 <= battery <= 100:
        raise ValueError("A verified battery health from 0 to 100 is required")
    for field in ("screen_cracked", "back_cracked"):
        if not isinstance(device_info.get(field), bool):
            raise ValueError(f"A verified {field} value is required")
    deductions = []
    for rule in rules["deductions"]:
        field = rule["field"]
        value = device_info.get(field, False)
        if not isinstance(value, bool):
            raise ValueError(f"{field} must be a boolean")
        if value:
            deductions.append({"field": field, "amount_azn": float(money(rule["amount_azn"])), "reason": rule["reason"]})
    for band in rules["battery_bands"]:
        if band["min"] <= battery <= band["max"]:
            if band["amount_azn"]:
                deductions.append({"field": "battery_health", "amount_azn": float(money(band["amount_azn"])),
                                   "reason": band["reason"]})
            break
    else:
        raise ValueError("Battery health does not match a configured band")
    final = max(money(0), money(base) - sum((money(d["amount_azn"]) for d in deductions), money(0)))
    return {"model": model, "storage": storage, "currency": rules.get("currency", "AZN"),
            "base_offer": float(money(base)), "deductions": deductions, "final_offer": float(final),
            "offer": float(final), "pickup_requirements": rules.get("pickup_requirements", [])}
