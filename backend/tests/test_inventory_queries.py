import pytest

from backend.tests.test_api import call, client
from backend.tools.inventory import search_inventory


@pytest.mark.parametrize("query,product", [
    ("Samsung in stock", "Samsung"),
    ("iPhone 15 in stock", "iPhone 15"),
    ("Do you have an iPhone 15 available?", "iPhone 15"),
    ("Please tell me the price of iPhone 15", "iPhone 15"),
    ("How much does the Samsung Galaxy S25+ cost?", "Samsung Galaxy S25+"),
    ("Can you show me Apple laptops that are available?", "Apple laptops"),
    ("What headphones do you have in stock today?", "headphones"),
])
def test_conversational_queries_return_the_same_products(pack, query, product):
    result = search_inventory(query, pack.catalog)
    expected = search_inventory(product, pack.catalog)
    assert result["items"] and [item["sku"] for item in result["items"]] == [item["sku"] for item in expected["items"]]
    assert result["fallback"] is None


@pytest.mark.parametrize("query,brand,category", [
    ("Samsung wonderful gadgets for school", "Samsung", None),
    ("laptops for everyday work", None, "laptops"),
    ("iPhone 99 in stock", "Apple", "phones"),
    ("Please find phones for everyday work", None, "phones"),
    ("Pixel 99 price please", "Google", "phones"),
])
def test_unmatched_query_falls_back_to_its_brand_or_category(pack, query, brand, category):
    result = search_inventory(query, pack.catalog, limit=20)
    assert result["items"] and result["fallback"]
    assert all((brand is None or item["brand"] == brand) and
               (category is None or item["category"] == category) for item in result["items"])
    assert all("99" not in item["name"] for item in result["items"])
    if brand is None:
        assert len({item["brand"] for item in result["items"]}) > 1  # A category must not imply one brand.


def test_fallback_respects_all_explicit_filters_and_current_stock(pack):
    catalog = [{**item, "stock": 0 if item["sku"] == "MBA13-M4-256-SKY" else item["stock"]} for item in pack.catalog]
    result = search_inventory("Apple laptops for wonderful school projects", catalog,
        category="laptops", brand="Apple", min_price=2000, max_price=3000, in_stock=True, limit=20)
    assert result["fallback"] and result["items"]
    assert all(item["brand"] == "Apple" and item["category"] == "laptops"
               and 2000 <= item["price_azn"] <= 3000 and item["stock"] > 0 for item in result["items"])
    assert "MBA13-M4-256-SKY" not in {item["sku"] for item in result["items"]}
    assert not search_inventory("iPhone 99", catalog, max_price=1)["items"]
    assert not search_inventory("Samsung interesting gadgets", catalog, brand="Apple")["items"]


def test_unknown_query_does_not_return_unrelated_catalog_items(pack):
    result = search_inventory("unicorn gizmo", pack.catalog)
    assert not result["items"] and result["fallback"] is None
    with pytest.raises(ValueError):
        search_inventory("Do you have any available in stock please?", pack.catalog)


def test_out_of_stock_match_stays_distinct_from_fallback(pack):
    result = search_inventory("Do you have iPhone 16 Pro 256 GB Black Titanium in stock?", pack.catalog)
    assert result["fallback"] is None and result["out_of_stock"]
    assert [item["sku"] for item in result["items"]] == ["IP16P-256-BLK"]
    assert result["alternatives"] and all(item["stock"] > 0 for item in result["alternatives"])


def test_watch_singular_and_category_queries_do_not_imply_apple_or_hp(pack):
    watches = search_inventory("watch available", pack.catalog, limit=20)["items"]
    assert watches and all(item["category"] == "watches" for item in watches)
    assert {item["brand"] for item in watches} == {"Apple", "Samsung"}
    laptops = search_inventory("laptops", pack.catalog, limit=20)["items"]
    assert {item["brand"] for item in laptops} == {"Apple", "Asus", "Lenovo", "HP", "Dell"}
    for query in ("iPhone 15 in stock", "iphon 15 in stock"):
        assert all(item["name"].startswith("iPhone") for item in search_inventory(query, pack.catalog, limit=20)["items"])


def test_conversational_search_through_http_dispatch(client):
    result = call(client, "search_inventory", {"query": "iPhone 15 in stock"}, channel="whatsapp")
    assert result["query"] == "iphone 15" and result["items"]
    assert client.app.state.db.trace("+994501234567")[-1]["result"] == result
    cards = client.app.state.db.inbox("+994501234567")["messages"]
    assert cards and all(message["type"] == "product_card" for message in cards)
