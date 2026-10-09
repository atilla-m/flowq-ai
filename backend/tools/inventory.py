from difflib import SequenceMatcher

from backend.tools.common import money, normalize_model, normalize_text


def search_inventory(query: str, catalog: list[dict], *, category: str | None = None,
                     brand: str | None = None, min_price: float | None = None,
                     max_price: float | None = None, in_stock: bool = False, limit: int = 6) -> dict:
    """Filter before fuzzy ranking; keep unavailable matches separate from alternatives."""
    query = normalize_model(query)
    if not query and not in_stock and not any(value is not None for value in (category, brand, min_price, max_price)):
        raise ValueError("Tell us a model, category, brand or price range")
    minimum = money(min_price) if min_price is not None else None
    maximum = money(max_price) if max_price is not None else None
    if minimum is not None and maximum is not None and minimum > maximum:
        raise ValueError("min_price must be no greater than max_price")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 20:
        raise ValueError("limit must be an integer from 1 to 20")
    tokens = query.split()
    numeric = [part for part in tokens if any(char.isdigit() for char in part)]
    variants = [part for part in tokens if part in ("plus", "pro", "max", "ultra", "mini", "fe")]
    def allowed(item):
        return ((not category or normalize_text(item.get("category", "")).rstrip("s") == normalize_text(category).rstrip("s"))
                and (not brand or normalize_text(item.get("brand", "")) == normalize_text(brand))
                and (minimum is None or money(item["price_azn"]) >= minimum)
                and (maximum is None or money(item["price_azn"]) <= maximum))

    candidates = [item for item in catalog if allowed(item)]
    ranked = []
    for item in candidates:
        name = normalize_model(" ".join(str(value) for value in (
            item['name'], item.get('storage', ''), 'GB', item.get('color', ''), item['sku'],
            item.get('brand', ''), item.get('category', ''), item.get('category', '').rstrip('s'),
            item.get('specs', {}).get('cpu', ''), item.get('specs', {}).get('ram_gb', ''))))
        words = name.split()
        model_words = normalize_model(f"{item['name']} {item.get('storage', '')} {item.get('color', '')} {item['sku']}").split()
        if any(number not in model_words for number in numeric):
            continue
        if any(variant not in words for variant in variants):
            continue
        matches = sum(1 for token in tokens if token in words or
                      (len(token) >= 4 and max((SequenceMatcher(None, token, word).ratio() for word in words), default=0) >= .8))
        score = matches / len(tokens) if tokens else 1
        if query == normalize_model(item['sku']):
            score = 2
        if score >= .6:
            ranked.append((score, item))
    ranked.sort(key=lambda match: (-match[0], -int(match[1]["stock"] > 0), match[1]["price_azn"]))
    out_of_stock = bool(ranked) and all(item['stock'] == 0 for _, item in ranked)
    alternatives = []
    if out_of_stock:
        requested = ranked[0][1]
        matched_skus = {item['sku'] for _, item in ranked}
        available = [item for item in candidates if item['stock'] > 0 and item['sku'] not in matched_skus
                     and item.get('category') == requested.get('category')]
        available.sort(key=lambda item: (
            item.get('brand') != requested.get('brand'),
            abs(item['price_azn'] - requested['price_azn']),
            -SequenceMatcher(None, item['name'], requested['name']).ratio(), item['sku']))
        alternatives = [dict(item) for item in available[:3]]
    items = [dict(item) for _, item in ranked if not in_stock or item['stock'] > 0][:limit]
    return {"items": items, "alternatives": alternatives, "out_of_stock": out_of_stock,
            "currency": "AZN", "query": query,
            "filters": {"category": category, "brand": brand, "min_price": min_price,
                        "max_price": max_price, "in_stock": in_stock}}


def get_accessories(phone_model: str, accessories: list[dict]) -> dict:
    model = normalize_model(phone_model)
    items = [dict(item) for item in accessories if any(normalize_model(compatible) == model
             for compatible in item["compatible_models"]) and item.get("stock", 0) > 0]
    return {"phone_model": phone_model, "items": items, "currency": "AZN"}
