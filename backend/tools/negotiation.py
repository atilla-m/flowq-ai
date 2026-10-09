from decimal import Decimal

from backend.tools.common import money


def negotiate_offer(base_offer, current_offer, customer_ask, config: dict) -> dict:
    """base_offer is the condition-adjusted final trade-in valuation, not the pristine value."""
    base = money(base_offer)
    max_pct = Decimal(str(config["max_increase_pct"]))
    step_pct = Decimal(str(config["step_pct"]))
    if not max_pct.is_finite() or not step_pct.is_finite() or not 0 <= max_pct <= 5 or step_pct <= 0:
        raise ValueError("Negotiation config must respect the 5% hard limit")
    maximum = money(base * (1 + max_pct / 100), floor=True)
    current = min(maximum, max(base, money(current_offer)))
    ask = money(customer_ask)
    step = max(Decimal("0.01"), money(base * step_pct / 100, floor=True))
    new_offer = current if ask <= current else min(maximum, current + step, ask)
    return {"new_offer": float(new_offer), "max_offer": float(maximum), "is_final": new_offer >= maximum,
            "base_offer": float(base), "currency": "AZN"}
