from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
import re
import unicodedata


def normalize_text(value: str) -> str:
    value = value.casefold().translate(str.maketrans("əıöüçşğ", "eioucsg"))
    return " ".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKD", value), flags=re.UNICODE))


def normalize_model(value: str) -> str:
    """A Plus variant must not collapse into the base model during compatibility/valuation."""
    return normalize_text(value.replace("+", " plus "))


def money(value, *, floor=False) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise ValueError("Invalid monetary value") from error
    if not number.is_finite() or number < 0 or number > Decimal("10000000"):
        raise ValueError("Monetary value must be finite and nonnegative")
    return number.quantize(Decimal("0.01"), rounding=ROUND_DOWN if floor else ROUND_HALF_UP)


def cents(value) -> int:
    return int(money(value) * 100)
