from decimal import Decimal
import json

import pytest

from backend.evals.fixtures import DIRECTORY
from backend.tests.test_api import call, client
from backend.tools.inventory import search_inventory
from backend.tools.policy import check_installment, find_branch, get_store_policy
from backend.tools.tradein import calculate_tradein


def test_catalog_and_tradein_cover_all_device_variants(pack):
    assert len(pack.catalog) == 80 and len(pack.accessories) == 40 and len(pack.customers) == 20
    assert len({item["sku"] for item in pack.catalog + pack.accessories}) == 120
    assert {item["category"] for item in pack.catalog} == {
        "phones", "laptops", "tablets", "watches", "headphones", "consoles"}
    for item in pack.catalog:
        assert item["brand"] and item["color"] in item["colors"] and item["warranty_months"] > 0
        assert set(item["specs"]) == {"storage_gb", "ram_gb", "cpu", "screen"}
        assert item["price_azn"] > 0 and isinstance(item["stock"], int) and item["stock"] >= 0
        if item["category"] in ("phones", "laptops", "tablets"):
            result = calculate_tradein({"model": item["name"], "storage": item["storage"],
                "battery_health": 95, "screen_cracked": False, "back_cracked": False}, pack.tradein_rules)
            assert 0 < result["final_offer"] < item["price_azn"]
            assert result["model"] == item["name"]


def test_plus_variant_preserves_compatibility_and_valuation(pack):
    from backend.tools.inventory import get_accessories
    from backend.vision import canonical_model
    assert not get_accessories("Samsung Galaxy S25+", pack.accessories)["items"]
    assert canonical_model("Samsung Galaxy S25+", pack.tradein_rules) == "Samsung Galaxy S25+"
    assert canonical_model("Samsung S25 Plus", pack.tradein_rules) == "Samsung Galaxy S25+"
    items = search_inventory("Samsung Galaxy S25+", pack.catalog)["items"]
    assert items and all(item["name"] == "Samsung Galaxy S25+" for item in items)


def test_filters_only_and_strict_alternative_filters(pack):
    result = search_inventory("", pack.catalog, category="laptop", brand="Apple", min_price=2000, max_price=3000)
    assert result["items"]
    assert all(item["category"] == "laptops" and item["brand"] == "Apple"
               and 2000 <= item["price_azn"] <= 3000 for item in result["items"])
    result = search_inventory("MacBook Pro 16 M4 Pro 512", pack.catalog,
                              category="laptops", brand="Apple", max_price=5000)
    assert result["out_of_stock"] and result["items"][0]["stock"] == 0
    assert result["alternatives"] and all(item["stock"] > 0 and item["category"] == "laptops"
        and item["brand"] == "Apple" and item["price_azn"] <= 5000 for item in result["alternatives"])
    assert search_inventory("", pack.catalog, category="phones", max_price=1)["items"] == []
    with pytest.raises(ValueError):
        search_inventory("", pack.catalog, min_price=2000, max_price=1000)


def test_unknown_models_and_available_variants_do_not_trigger_alternatives(pack):
    unknown = search_inventory("iPhone 99", pack.catalog)
    assert unknown["items"] and unknown["fallback"] and not unknown["alternatives"]
    available = search_inventory("iPhone 17", pack.catalog)
    assert available["items"] and not available["out_of_stock"]
    assert all(item["category"] == "phones" for item in available["items"])
    only_stock = search_inventory("", pack.catalog, category="laptops", in_stock=True, limit=20)
    assert all(item["stock"] > 0 for item in only_stock["items"])
    assert all(item["stock"] > 0 for item in search_inventory("", pack.catalog, in_stock=True)["items"])


@pytest.mark.parametrize("months", [3, 6, 12])
def test_installments_sum_to_price_in_cents(pack, months):
    for item in pack.catalog:
        result = check_installment(item["sku"], months, pack.catalog, pack.policy)
        if result["eligible"]:
            monthly = Decimal(str(result["monthly_payment_azn"]))
            final = Decimal(str(result["final_payment_azn"]))
            assert monthly * (months - 1) + final == Decimal(str(item["price_azn"]))
            assert result["total_azn"] == item["price_azn"] and result["approval_required"]
        else:
            assert "reason" in result and "monthly_payment_azn" not in result


def test_installments_reject_unsupported_terms_stock_and_low_price(pack):
    assert not check_installment("IP15-128-BLK", 9, pack.catalog, pack.policy)["eligible"]
    assert not check_installment("IP16P-256-BLK", 6, pack.catalog, pack.policy)["eligible"]
    assert not check_installment("GFIT3-SLV", 3, pack.catalog, pack.policy)["eligible"]
    with pytest.raises(ValueError):
        check_installment("UNKNOWN", 6, pack.catalog, pack.policy)


def test_policy_lookup_and_branch_aliases_and_ambiguity(pack):
    assert get_store_policy("returns", pack.policy)["policy"]["days"] == 14
    assert get_store_policy("all", pack.policy)["policy"]["installments"]["months"] == [3, 6, 12]
    assert get_store_policy("unknown", pack.policy)["needs_clarification"]
    result = find_branch("Nəsimi, Azadlıq prospekti", pack.policy, pack.delivery)
    assert result["branches"][0]["id"] == "branch_nasimi" and result["branches"][0]["hours"]
    assert find_branch("Нариманов", pack.policy, pack.delivery)["branches"][0]["id"] == "branch_narimanov"
    for district in ("Baku", "Gəncə", "Yasamal and Nəsimi"):
        assert find_branch(district, pack.policy, pack.delivery)["needs_clarification"]
    for district in pack.delivery["districts"]:
        assert not find_branch(district["name"], pack.policy, pack.delivery)["needs_clarification"]


def test_seeded_order_history_is_trackable_and_never_manufactures_payment(db, pack):
    unpaid_phone = pack.customers[10]["phone"]
    history = db.history(unpaid_phone)
    assert history["past_orders"][0]["status"] == "awaiting_payment"
    assert db.order("DEMO-12-01")["status"] == "returned"
    assert db.order("DEMO-13-01")["tradein"]["historical"]
    with db.connection() as connection:
        first_stock = dict(connection.execute("SELECT sku, quantity FROM stock WHERE pack=?", (pack.name,)))
        assert connection.execute("SELECT COUNT(*) FROM payments WHERE status='paid'").fetchone()[0] == 0
        assert connection.execute("SELECT status FROM payments WHERE order_id='DEMO-11-01'").fetchone()[0] == "pending"
        connection.execute("UPDATE stock SET quantity=quantity-1 WHERE sku='IP15-128-BLK'")
    db.initialize(pack)
    with db.connection() as connection:
        after = dict(connection.execute("SELECT sku, quantity FROM stock WHERE pack=?", (pack.name,)))
        assert after["SS25-128-NAV"] == first_stock["SS25-128-NAV"]
        assert after["IP15-128-BLK"] == first_stock["IP15-128-BLK"] - 1
        assert connection.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 10


def test_new_tools_use_http_dispatch_and_trace(client):
    assert call(client, "get_store_policy", {"topic": "returns"})["policy"]["days"] == 14
    quote = call(client, "check_installment", {"sku": "MBA13-M4-256-SKY", "months": 6})
    assert quote["eligible"] and quote["price_azn"] == 2499
    assert call(client, "find_branch", {"district": "Yasamal"})["branches"][0]["district"] == "Yasamal"
    result = call(client, "search_inventory", {"category": "tablets", "brand": "Samsung", "max_price": 1100})
    assert all(item["category"] == "tablets" and item["brand"] == "Samsung" for item in result["items"])
    assert {entry["tool"] for entry in client.app.state.db.trace("+994501234567")} >= {
        "get_store_policy", "check_installment", "find_branch", "search_inventory"}


def test_nonphone_checkout_and_compatible_accessory(client):
    order = call(client, "create_order", {"items": [{"sku": "MBA13-M4-256-SKY"}, {"sku": "ACC-031"}], "address": "pickup"})
    assert order["total"] == 2548 and order["items"][0]["kind"] == "product"
    assert order["items"][0]["category"] == "laptops" and order["items"][0]["warranty_months"] == 12
    wrong = call(client, "create_order", {"items": [{"sku": "MBA13-M4-256-SKY"}, {"sku": "ACC-006"}], "address": "pickup"})
    assert wrong["error"] == "invalid_request"


def test_seeded_payment_state_is_not_falsely_confirmed(client, pack):
    returned_phone = pack.customers[11]["phone"]
    assert call(client, "check_payment_status", {"order_id": "DEMO-12-01"}, phone=returned_phone)["status"] == "not_recorded"
    assert call(client, "create_payment_link", {"order_id": "DEMO-12-01"}, phone=returned_phone)["error"]
    assert client.post("/api/payments/DEMO-12-01/pay").status_code == 409
    assert client.get("/api/orders/DEMO-12-01").json()["status"] == "returned"
    assert client.post("/api/payments/DEMO-11-01/pay").json() == {"status": "paid"}
    client.app.state.db.initialize(pack)
    assert client.get("/api/orders/DEMO-11-01").json()["status"] == "paid"


def test_eval_skus_and_zero_stock_requests_exist(pack):
    scenarios = json.loads((DIRECTORY / "scenarios.json").read_text())
    catalog = {item["sku"]: item for item in pack.catalog}
    for scenario in scenarios:
        facts = scenario["hidden_facts"]
        assert facts["target_sku"] in catalog and catalog[facts["target_sku"]]["stock"] > 0
        assert catalog[facts["target_sku"]]["name"] == facts["phone_model"]
        assert any(item["sku"] == facts["target_sku"] for item in
            search_inventory(facts["target_query"], pack.catalog, **facts.get("inventory_filters", {}))["items"])
        if facts.get("requested_sku"):
            assert catalog[facts["requested_sku"]]["stock"] == 0
