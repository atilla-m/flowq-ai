"""Pure store-policy lookups and installment estimates from industry-pack data."""
from copy import deepcopy
from decimal import Decimal, ROUND_DOWN

from backend.tools.common import money, normalize_text


def get_store_policy(topic: str, policy: dict) -> dict:
    topic = normalize_text(topic)
    canonical = next((key for key in ("branches", "returns", "warranty", "installments")
                      if topic.rstrip("s") == key.rstrip("s")), None)
    if topic in ("all", "policy", "store policy"):
        return {"topic": "all", "policy": deepcopy(policy)}
    if canonical is None:
        return {"needs_clarification": True, "topics": ["branches", "returns", "warranty", "installments"],
                "question": "Would you like branch, return, warranty or installment information?"}
    return {"topic": canonical, "policy": deepcopy(policy[canonical]),
            "timezone": policy.get("timezone"), "demo_data": policy.get("demo_data", False)}


def check_installment(sku: str, months: int, catalog: list[dict], policy: dict) -> dict:
    item = next((item for item in catalog if item["sku"] == sku), None)
    if item is None:
        raise ValueError("Unknown catalog SKU")
    config = policy["installments"]
    result = {"sku": sku, "months": months, "currency": "AZN", "eligible": False,
              "available_months": list(config["months"]), "conditions": list(config["conditions"])}
    if isinstance(months, bool) or months not in config["months"]:
        return {**result, "reason": "Please choose one of the available installment terms."}
    if item.get("category") not in config["eligible_categories"]:
        return {**result, "reason": "Installments are unavailable for this product category."}
    if config.get("requires_in_stock") and item["stock"] <= 0:
        return {**result, "reason": "This SKU is currently out of stock."}
    price = money(item["price_azn"])
    if price < money(config["minimum_price_azn"]):
        return {**result, "reason": "This SKU is below the minimum installment price.",
                "minimum_price_azn": config["minimum_price_azn"]}
    down = money(config["down_payment_azn"])
    if down > price:
        raise ValueError("Installment down payment exceeds the catalog price")
    financed = money((price - down) * (1 + Decimal(str(config["interest_pct"])) / 100) + money(config["fee_azn"]))
    monthly = (financed / months).quantize(Decimal(".01"), rounding=ROUND_DOWN)
    final = financed - monthly * (months - 1)
    return {**result, "eligible": True, "price_azn": float(price), "down_payment_azn": float(down),
            "interest_pct": config["interest_pct"], "fee_azn": config["fee_azn"],
            "monthly_payment_azn": float(monthly), "final_payment_azn": float(final),
            "total_azn": float(financed + down), "approval_required": True}


def find_branch(district: str, policy: dict, delivery: dict) -> dict:
    text = f" {normalize_text(district)} "
    matches = [entry["name"] for entry in delivery["districts"] if any(
        f" {normalize_text(alias)} " in text for alias in [entry["name"], *entry.get("aliases", [])])]
    if len(matches) != 1:
        return {"district": district, "branches": [], "needs_clarification": True,
                "question": "Which Baku district or nearby city should I use to suggest a branch?"}
    matched = matches[0]
    branches = [deepcopy(branch) for branch in policy["branches"]
                if matched in branch["serves_districts"] or matched == branch["district"]]
    return {"district": matched, "branches": branches, "needs_clarification": not bool(branches),
            "timezone": policy.get("timezone", "Asia/Baku"), "demo_data": policy.get("demo_data", False),
            "selection": "District service assignment; not a live distance or opening-status calculation."}
