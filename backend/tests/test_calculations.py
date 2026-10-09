from decimal import Decimal
import random

import pytest

from backend.tools.delivery import calculate_delivery
from backend.tools.inventory import get_accessories, search_inventory
from backend.tools.negotiation import negotiate_offer
from backend.tools.tradein import calculate_tradein


def test_tradein_math_explains_photo_damage(pack):
    result = calculate_tradein({"model": "iPhone 13", "storage": 128, "battery_health": 79,
                               "screen_cracked": True, "back_cracked": False, "repaired_before": True}, pack.tradein_rules)
    assert result["base_offer"] == 480
    assert result["final_offer"] == 260  # 480 - 100 screen - 80 battery - 40 repair
    assert sum(d["amount_azn"] for d in result["deductions"]) == 220
    assert result["pickup_requirements"]


@pytest.mark.parametrize("health,deduction", [(0, 80), (79, 80), (80, 35), (89, 35), (90, 0), (100, 0)])
def test_battery_bands(pack, health, deduction):
    result = calculate_tradein({"model": "iPhone 13", "storage": 128, "battery_health": health,
                               "screen_cracked": False, "back_cracked": False}, pack.tradein_rules)
    assert result["final_offer"] == 480 - deduction


def test_tradein_zero_floor_and_unknown_variant(pack):
    device = {"model": "iPhone 11", "storage": 64, "battery_health": 70,
              "screen_cracked": True, "back_cracked": True, "water_damage": True}
    assert calculate_tradein(device, pack.tradein_rules)["final_offer"] == 0
    with pytest.raises(ValueError):
        calculate_tradein({**device, "storage": 512}, pack.tradein_rules)
    with pytest.raises(ValueError):
        calculate_tradein({**device, "screen_cracked": "false"}, pack.tradein_rules)


def test_negotiation_thousand_random_asks_never_exceeds_cap(pack):
    rng = random.Random(42)
    for _ in range(1000):
        base = Decimal(rng.randint(0, 500000)) / 100
        current = Decimal(rng.randint(0, 800000)) / 100
        ask = Decimal(rng.randint(0, 1000000)) / 100
        result = negotiate_offer(base, current, ask, pack.negotiation)
        assert Decimal(str(result["new_offer"])) <= base * Decimal("1.05")
        assert Decimal(str(result["new_offer"])) >= base


def test_negotiation_steps_and_final(pack):
    result = negotiate_offer(480, 480, 900, pack.negotiation)
    assert result["new_offer"] == 489.6
    result = negotiate_offer(480, result["new_offer"], 900, pack.negotiation)
    assert result["new_offer"] == 499.2
    result = negotiate_offer(480, result["new_offer"], 900, pack.negotiation)
    assert result["new_offer"] == 504 and result["is_final"] is True
    assert negotiate_offer(480, 504, 10000, pack.negotiation)["new_offer"] == 504


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1])
def test_negotiation_rejects_bad_money(pack, value):
    with pytest.raises(ValueError):
        negotiate_offer(480, 480, value, pack.negotiation)


def test_accessories_and_images_match_exact_model(pack):
    models = {item["name"] for item in pack.catalog}
    for model in models:
        result = get_accessories(model, pack.accessories)
        for item in result["items"]:
            assert model in item["compatible_models"]
            assert model in (pack.directory / "assets" / f"{item['sku']}.svg").read_text()
    assert not get_accessories("iPhone 15 Pro Max", pack.accessories)["items"]
    assert all(item["compatible_models"] == ["iPhone 15"] for item in get_accessories("iPhone 15", pack.accessories)["items"])


@pytest.mark.parametrize("address,fee", [("Yasamal, Mətbuat prospekti 10", 3), ("Nəsimi rayonu", 3),
    ("Бинагади", 4), ("Sumqayit", 10), ("Abşeron, Xırdalan", 8), ("pickup", 0), ("mağazadan götürəcəyəm", 0)])
def test_delivery_lookup(pack, address, fee):
    result = calculate_delivery(address, pack.delivery)
    assert result["fee_azn"] == fee and not result["needs_clarification"]


def test_delivery_unknown_and_ambiguous(pack):
    for address in ("Bakı", "Gəncə", "Yasamal və Nəsimi"):
        result = calculate_delivery(address, pack.delivery)
        assert result["needs_clarification"] and result["fee_azn"] is None


def test_inventory_fuzzy_and_numeric_variants(pack):
    items = search_inventory("iphon 15 128", pack.catalog)["items"]
    assert items and all(item["name"] == "iPhone 15" and item["storage"] == 128 for item in items)
    assert search_inventory("S24", pack.catalog)["items"][0]["name"] == "Samsung Galaxy S24"
    assert not search_inventory("iPhone 99", pack.catalog)["items"]
