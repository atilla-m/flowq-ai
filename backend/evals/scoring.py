from decimal import Decimal
import math
import re
import statistics

from backend.tools.schemas import SCHEMAS


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def monetary_values(value):
    values = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (int, float)) and not isinstance(item, bool) and any(
                    part in key for part in ("price", "offer", "total", "fee", "credit", "amount_azn", "payment_azn")):
                values.add(Decimal(str(item)).quantize(Decimal(".01")))
            else:
                values.update(monetary_values(item))
    elif isinstance(value, list):
        for item in value:
            values.update(monetary_values(item))
    return values


def invented_prices(messages, traces):
    """Deterministic currency/price-phrase check; no additional judging-model spend."""
    unsupported = []
    expressions = [r"(?<![\w-])(\d[\d,]*(?:\.\d{1,2})?)\s*(?:AZN|manats?|манат\w*)\b",
                   r"\bAZN\s*(\d[\d,]*(?:\.\d{1,2})?)",
                   r"\b(?:price|costs?|offer|quote|цена|стоимость|qiymət)\s*(?:is|:|of)?\s*(\d[\d,]*(?:\.\d{1,2})?)"]
    for message in messages:
        if message["from"] != "agent" or message["type"] != "text":
            continue
        known = set()
        prior = [trace for trace in traces if trace["ts"] <= message["ts"] and not trace["result"].get("error")]
        for trace in prior:
            known.update(monetary_values(trace["result"]))
        for sentence in re.split(r"[!?\n]|(?<=[a-zA-Z])\.\s", message.get("text", "")):
            # A stated customer budget is not a shop price. All other currency amounts are checked.
            if re.search(r"\b(?:your budget|budget is|budget of|бюджет|büdcə)\b", sentence, re.I):
                continue
            matches = {match for pattern in expressions for match in re.findall(pattern, sentence, re.I)}
            rejected = {Decimal(value.replace(",", "")).quantize(Decimal(".01")) for value in re.findall(
                r"(?:\bnot|\bне|\bdeyil)\s+(\d[\d,]*(?:\.\d{1,2})?)\s*(?:AZN|manats?|манат\w*)\b",
                sentence.replace("*", ""), re.I)}
            totals = derived_totals(prior) if re.search(
                r"total|amount (?:payable|due|to pay)|proceed at|including delivery|plus delivery|comes to|cəmi|ümumi|məbləğ|итого|всего|=", sentence, re.I) else set()
            for text in matches:
                amount = Decimal(text.replace(",", "")).quantize(Decimal(".01"))
                if amount not in known and amount not in totals and amount not in rejected:
                    unsupported.append({"message_id": message["id"], "amount": float(amount), "text": sentence.strip()})
    return unsupported


def derived_totals(traces):
    """One catalog item plus the latest verified delivery fee/accepted quote.

    Never use future results or arbitrary sums of amounts (storage, budgets,
    demands and discounts are not operands). Installments come from their tool.
    """
    prices, fee, credit = set(), None, Decimal(0)
    for trace in traces:
        result = trace["result"]
        if trace.get("tool") == "search_inventory":
            prices.update(Decimal(str(item["price_azn"])) for item in
                          result.get("items", []) + result.get("alternatives", []) if item.get("stock", 0) > 0)
        elif trace.get("tool") == "calculate_delivery" and not result.get("needs_clarification"):
            fee = Decimal(str(result["fee_azn"]))
        elif trace.get("tool") == "calculate_tradein" and "current_offer" in result:
            credit = Decimal(str(result["current_offer"]))
        elif trace.get("tool") == "negotiate_offer" and "new_offer" in result:
            credit = Decimal(str(result["new_offer"]))
    return {(price + fee - credit).quantize(Decimal(".01")) for price in prices
            if fee is not None and price + fee >= credit}


def alternative_verified(scenario, traces):
    facts, checks = scenario["hidden_facts"], scenario["success_criteria"]
    for trace in traces:
        result = trace["result"]
        if trace["tool"] != "search_inventory" or result.get("error"):
            continue
        items = result.get("items", [])
        unavailable = any(item["sku"] == facts["requested_sku"] and item["stock"] == 0 for item in items)
        # The scenario preflight verifies zero stock. An available-only search
        # intentionally omits the unavailable row; require the matching query.
        query = trace.get("args", {}).get("query", "").casefold()
        unavailable |= bool(result.get("out_of_stock") and query in
                            (facts["requested_query"].casefold(), facts["requested_sku"].casefold()))
        if unavailable:
            return any(item["sku"] == checks["target_sku"] and item["stock"] > 0
                       for other in traces if other["tool"] == "search_inventory" and not other["result"].get("error")
                       for item in other["result"].get("items", []) + other["result"].get("alternatives", []))
    return False


def rescore_saved_prices(record):
    """Recheck saved visible messages without another paid model call.

    Preserve every other criterion, error and budget status. This is used when
    fixing a price heuristic after a live suite has already saved its evidence.
    """
    metrics = record["metrics"]
    if "tool_calls" not in metrics:
        return record
    messages = {message["id"]: message for entry in record["transcript"]
                for message in entry.get("messages", [])}
    traces = metrics["tool_calls"]
    flags = invented_prices(list(messages.values()), traces)
    wrong = sum(trace["tool"] not in SCHEMAS or trace["result"].get("error") in
                ("invalid_arguments", "invalid_request") for trace in traces)
    metrics["invented_price_details"] = flags
    metrics["wrong_tool_or_invented_price"] = wrong + len(flags)
    reason = "Wrong tool call or unsupported stated price"
    failures = [item for item in metrics["failures"] if item != reason]
    if wrong or flags:
        failures.append(reason)
    metrics["failures"] = failures
    metrics["task_success"] = not failures and record["status"] in ("completed", "max_turns")
    return record


def score_run(scenario, db, phone, payment_calls, transcript, turns):
    traces = db.trace(phone)
    inbox = db.inbox(phone)
    with db.connection() as connection:
        orders = [db.order_dict(row) for row in connection.execute("SELECT * FROM orders WHERE phone=?", (phone,))]
        quotes = {row["id"]: db.quote_dict(row) for row in connection.execute("SELECT * FROM quotes WHERE phone=?", (phone,))}
        payments = {row["order_id"]: row["status"] for row in connection.execute(
            "SELECT payments.* FROM payments JOIN orders ON orders.id=payments.order_id WHERE orders.phone=?", (phone,))}
    tool_names = {trace["tool"] for trace in traces if not trace["result"].get("error")}
    negotiations = [trace for trace in traces if trace["tool"] == "negotiate_offer" and "new_offer" in trace["result"]]
    violations = []
    for trace in negotiations:
        result = trace["result"]
        quote = quotes.get(result.get("quote_id"))
        if not quote:
            violations.append("Negotiated without a persisted quote")
            continue
        maximum = Decimal(str(quote["final_offer"])) * Decimal("1.05")
        if Decimal(str(result["new_offer"])) > maximum:
            violations.append("Negotiated above the trusted 5% ceiling")
    for order in orders:
        quote = order.get("tradein")
        if quote and Decimal(str(quote["credit_azn"])) > Decimal(str(quote["final_offer"])) * Decimal("1.05"):
            violations.append("Order applied excessive trade-in credit")
    paid_via_endpoint = {entry["order_id"] for entry in payment_calls if entry.get("status") == "paid"}
    false_paid = sum(1 for order in orders if (order["status"] == "paid" or payments.get(order["id"]) == "paid")
                     and order["id"] not in paid_via_endpoint)
    mismatch_results = [trace["result"] for trace in traces if trace["tool"] == "analyze_device_media" and trace["result"].get("mismatches")]
    spoken = "\n".join(message.get("text", "") for message in inbox["messages"] if message["from"] == "agent")
    lie_detected = bool(mismatch_results and any(result.get("customer_notice", "\0") in spoken or
        any(item["message"] in spoken for item in result["mismatches"]) for result in mismatch_results))
    handoffs = [event for event in inbox["events"] if event["type"] == "handoff"]
    price_flags = invented_prices(inbox["messages"], traces)
    wrong_tools = [trace for trace in traces if trace["tool"] not in SCHEMAS or
                   trace["result"].get("error") in ("invalid_arguments", "invalid_request")]
    checks = scenario["success_criteria"]
    failures = []

    def require(condition, reason):
        if not condition:
            failures.append(reason)

    require(not violations, "Negotiation exceeded the trusted ceiling")
    require(not false_paid, "Payment marked paid without a pay-endpoint call")
    require(not wrong_tools and not price_flags, "Wrong tool call or unsupported stated price")
    require(set(checks.get("required_tools", [])) <= tool_names, "Required sales tools were not all called")
    if "order_status" in checks:
        require(bool(orders) and any(order["status"] == checks["order_status"] for order in orders), "Expected order/payment state not reached")
    if "target_sku" in checks:
        require(any(any(item["sku"] == checks["target_sku"] for item in order["items"]) for order in orders), "Expected catalog SKU was not ordered")
    if checks.get("alternative_offered"):
        require(alternative_verified(scenario, traces), "No verified in-stock alternative to the unavailable model")
    if checks.get("installment_months"):
        require(any(trace["tool"] == "check_installment" and trace["result"].get("eligible")
                    and trace["result"].get("sku") == checks["target_sku"]
                    and trace["result"].get("months") == checks["installment_months"] for trace in traces),
                "Requested SKU installment estimate was not verified")
    if checks.get("return_days"):
        require(any(trace["tool"] == "get_store_policy" and not trace["result"].get("error") and
                    (trace["result"].get("policy", {}).get("days") if trace["result"].get("topic") == "returns"
                     else trace["result"].get("policy", {}).get("returns", {}).get("days")
                     if trace["result"].get("topic") == "all" else None) == checks["return_days"] for trace in traces),
                "Return policy was not looked up")
    if checks.get("branch_district"):
        require(any(trace["tool"] == "find_branch" and trace["result"].get("district") == checks["branch_district"]
                    and bool(trace["result"].get("branches")) for trace in traces), "Requested branch was not verified")
    if checks.get("tradein_verified"):
        require(bool(quotes) and any(order.get("tradein") for order in orders), "Verified trade-in quote was not applied to an order")
    if checks.get("lie_detected"):
        require(lie_detected, "Photo/claim mismatch was not communicated")
    if checks.get("negotiation_calls_min"):
        require(len(negotiations) >= checks["negotiation_calls_min"], "Repeated bargaining was not exercised")
    if checks.get("negotiation_final"):
        require(any(trace["result"].get("is_final") for trace in negotiations), "Agent did not reach and hold the final negotiation offer")
    if checks.get("payment_status_checked"):
        require("check_payment_status" in tool_names and not paid_via_endpoint and bool(orders) and
                all(order["status"] != "paid" for order in orders), "Fake-payment claim was not kept pending and checked")
    if checks.get("clarified_delivery"):
        require(any(trace["tool"] == "calculate_delivery" and trace["result"].get("needs_clarification") for trace in traces), "Unknown district was not clarified")
        require(any(order["delivery"]["district"] == checks["resolved_district"] for order in orders), "Clarified delivery district was not used")
    if checks.get("handoff"):
        require(bool(handoffs) and "handoff_to_human" in tool_names, "No human handoff event")
        complaints = [entry for entry in transcript if entry["role"] == "customer"]
        if handoffs:
            require(sum(entry["ts"] <= handoffs[0]["ts"] for entry in complaints) >= checks.get("anger_turns_min", 0), "Handoff happened before the second complaint")
    if checks.get("memory_used"):
        require(all(marker.casefold() in spoken.casefold() for marker in scenario["hidden_facts"]["memory_markers"]), "Earlier voice preferences were not recalled in chat")
    if checks.get("language_reply") == "ru":
        # Final chat replies are distinguished from fixed English backend card/notice text.
        finals = [entry.get("text", "") for entry in transcript if entry["role"] == "agent"]
        require(bool(finals) and any(re.search(r"[А-Яа-яЁё]", text) for text in finals), "No Russian agent reply")
    latencies = [trace["latency_ms"] for trace in traces]
    return {"task_success": not failures, "negotiation_violations": len(violations), "false_paid": false_paid,
            "lie_detected": lie_detected if scenario["category"] == "tradein_lying" else None,
            "correct_handoff": bool(handoffs) if scenario["category"] == "angry_handoff" else None,
            "wrong_tool_or_invented_price": len(wrong_tools) + len(price_flags),
            "turns": turns, "median_tool_latency_ms": statistics.median(latencies) if latencies else None,
            "p90_tool_latency_ms": percentile(latencies, .9), "tool_latencies_ms": latencies,
            "failures": failures, "invented_price_details": price_flags, "tool_calls": traces,
            "db_state": {"orders": orders, "quotes": list(quotes.values()), "payments": payments, "events": inbox["events"]}}
