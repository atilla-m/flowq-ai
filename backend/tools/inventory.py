from difflib import SequenceMatcher

from backend.tools.common import money, normalize_model, normalize_text


FILLER_WORDS = frozenset("""
    in stock available availability do does did you your have has got is are there
    any the a an can could would please price prices cost costs how much what which
    for me show tell find looking look want wants need buy purchase sell sells
    i we us to of at on now currently today thanks thank check about and or with
""".split())
VARIANT_WORDS = frozenset(("plus", "pro", "max", "ultra", "mini", "fe"))


def _token_score(token: str, word: str) -> float:
    if token == word:
        return 1
    return SequenceMatcher(None, token, word).ratio() if len(token) >= 4 else 0


def _singular(category: str) -> str:
    return category[:-2] if category.endswith("ches") else category.removesuffix("s")


def _query_context(tokens: list[str], catalog: list[dict]) -> tuple[set[str], set[str]]:
    """Infer brand/category scopes from catalog data, including model families."""
    brands, categories, families = {}, {}, {}
    for item in catalog:
        brand = normalize_text(item.get("brand", ""))
        category = normalize_text(item.get("category", ""))
        if brand:
            brands[brand] = brand
        if category:
            categories[category] = categories[_singular(category)] = category
        words = normalize_model(item["name"]).split()
        # A family such as iPhone, MacBook or Pixel narrows a broad fallback.
        family = next((word for word in words if word not in brand.split()), "")
        if family and len(family) >= 3 and family not in VARIANT_WORDS and family not in (category, _singular(category)):
            family_brands, family_categories = families.setdefault(family, (set(), set()))
            if brand:
                family_brands.add(brand)
            if category:
                family_categories.add(category)

    def mentions(vocabulary):
        return {value for name, value in vocabulary.items() if any(
            _token_score(token, name) >= .8 for token in tokens)}

    named_brands, named_categories = mentions(brands), mentions(categories)
    # Prefer iPhone over a fuzzy "phone" match, but never infer Apple from generic "phones".
    family_tokens = [token for token in tokens if
        max((_token_score(token, family) for family in families), default=0) >
        max((_token_score(token, name) for name in categories), default=0)]
    family_brands, family_categories = set(), set()
    for family, (item_brands, item_categories) in families.items():
        if any(_token_score(token, family) >= .8 for token in family_tokens):
            family_brands.update(item_brands)
            family_categories.update(item_categories)
    return named_brands or family_brands, named_categories or family_categories


def search_inventory(query: str, catalog: list[dict], *, category: str | None = None,
                     brand: str | None = None, min_price: float | None = None,
                     max_price: float | None = None, in_stock: bool = False, limit: int = 6) -> dict:
    """Filter before fuzzy ranking; keep unavailable matches separate from alternatives."""
    query = " ".join(token for token in normalize_model(query).split() if token not in FILLER_WORDS)
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
    variants = [part for part in tokens if part in VARIANT_WORDS]
    query_brands, query_categories = _query_context(tokens, catalog)

    def allowed(item):
        item_category = normalize_text(item.get("category", ""))
        return ((not category or _singular(item_category) == _singular(normalize_text(category)))
                and (not brand or normalize_text(item.get("brand", "")) == normalize_text(brand))
                and (minimum is None or money(item["price_azn"]) >= minimum)
                and (maximum is None or money(item["price_azn"]) <= maximum))

    candidates = [item for item in catalog if allowed(item)]
    scoped = [item for item in candidates
              if (not query_brands or normalize_text(item.get("brand", "")) in query_brands)
              and (not query_categories or normalize_text(item.get("category", "")) in query_categories)]
    ranked = []
    for item in scoped:
        name = normalize_model(" ".join(str(value) for value in (
            item['name'], item.get('storage', ''), 'GB', item.get('color', ''), item['sku'],
            item.get('brand', ''), item.get('category', ''), _singular(item.get('category', '')),
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
    if ranked:
        # A full exact match must not be diluted by partial matches to other variants.
        best_score = max(score for score, _ in ranked)
        ranked = [(score, item) for score, item in ranked if score == best_score]
    fallback = None
    if not ranked and (query_brands or query_categories or brand or category):
        ranked = [(0, item) for item in scoped]
        if ranked:
            fallback = {"brands": sorted(query_brands), "categories": sorted(query_categories),
                        "reason": "No matching model or variant was found. These are broader brand/category results."}
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
            "currency": "AZN", "query": query, "fallback": fallback,
            "filters": {"category": category, "brand": brand, "min_price": min_price,
                        "max_price": max_price, "in_stock": in_stock}}


def get_accessories(phone_model: str, accessories: list[dict]) -> dict:
    model = normalize_model(phone_model)
    items = [dict(item) for item in accessories if any(normalize_model(compatible) == model
             for compatible in item["compatible_models"]) and item.get("stock", 0) > 0]
    return {"phone_model": phone_model, "items": items, "currency": "AZN"}
