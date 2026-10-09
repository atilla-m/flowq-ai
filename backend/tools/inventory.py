from difflib import SequenceMatcher

from backend.tools.common import normalize_text


def search_inventory(query: str, catalog: list[dict], *, limit: int = 6) -> dict:
    """Rank matching names/SKUs, with strict numeric variant filters."""
    query = normalize_text(query)
    if not query:
        raise ValueError("Tell us which model you want")
    tokens = query.split()
    numeric = [part for part in tokens if part.isdigit()]
    ranked = []
    for item in catalog:
        name = normalize_text(f"{item['name']} {item['storage']} GB {item['color']} {item['sku']}")
        words = name.split()
        if any(number not in words for number in numeric):
            continue
        matches = sum(1 for token in tokens if token in words or
                      (len(token) >= 4 and max((SequenceMatcher(None, token, word).ratio() for word in words), default=0) >= .8))
        score = matches / len(tokens)
        if score >= .6:
            ranked.append((score, item))
    ranked.sort(key=lambda match: (-match[0], -int(match[1]["stock"] > 0), match[1]["price_azn"]))
    return {"items": [dict(item) for _, item in ranked[:limit]], "currency": "AZN", "query": query}


def get_accessories(phone_model: str, accessories: list[dict]) -> dict:
    model = normalize_text(phone_model)
    items = [dict(item) for item in accessories if any(normalize_text(compatible) == model
             for compatible in item["compatible_models"]) and item.get("stock", 0) > 0]
    return {"phone_model": phone_model, "items": items, "currency": "AZN"}
