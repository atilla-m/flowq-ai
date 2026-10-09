"""Offline grader, budget and diagnostics regressions. No provider requests."""
import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from openai import BadRequestError
import httpx

from backend.config import Settings
from backend.db import Database
from backend.evals.budget import BudgetExceeded, CostBudget, MeteredResponses
from backend.evals.fixtures import DIRECTORY, FixtureVisionAI
from backend.evals.customer import SimulatedCustomer
from backend.evals.report import render_report
from backend.evals import run_evals
from backend.evals.run_evals import redact, select_scenarios, validate_scenarios
from backend.evals.scoring import alternative_verified, invented_prices, score_run
from backend.pack import IndustryPack


def test_checkout_math_only_uses_prior_tools_and_total_context():
    message = {"id": "m", "from": "agent", "type": "text", "ts": "2", "text": "Total: 1402 AZN."}
    traces = [
        {"ts": "1", "tool": "search_inventory", "result": {"items": [{"price_azn": 1399, "stock": 5}]}},
        {"ts": "1", "tool": "calculate_delivery", "result": {"fee_azn": 3}}]
    assert not invented_prices([message], traces)
    assert not invented_prices([{**message, "text": "Amount payable: 1402 AZN."}], traces)
    assert not invented_prices([{**message, "text": "Do you agree to proceed at 1402 AZN?"}], traces)
    assert invented_prices([{**message, "text": "Amount payable: 1403 AZN."}], traces)
    assert invented_prices([{**message, "text": "Total: 1403 AZN."}], traces)
    assert invented_prices([{**message, "text": "The phone price is 1402 AZN."}], traces)
    assert invented_prices([message], [{**t, "ts": "3"} for t in traces])
    assert invented_prices([message], traces[:1])
    traces += [{"ts": "1", "tool": "calculate_tradein", "result": {"current_offer": 480}}]
    assert not invented_prices([{**message, "text": "Total: 922 AZN."}], traces)
    assert invented_prices([{**message, "text": "Total: 882 AZN."}], traces)  # invented credit


def test_installments_require_tool_result_and_cents():
    message = {"id": "m", "from": "agent", "type": "text", "ts": "2", "text": "416.50 AZN/month."}
    traces = [{"ts": "1", "tool": "check_installment", "result": {"monthly_payment_azn": 416.5, "months": 6}}]
    assert not invented_prices([message], traces)
    assert invented_prices([{**message, "text": "416.51 AZN/month."}], traces)
    assert invented_prices([message], [{**traces[0], "ts": "3"}])


def test_rejected_customer_total_is_not_an_offered_price():
    message = {"id": "m", "from": "agent", "type": "text", "ts": "2",
               "text": "Backend total: **951 AZN**, not 1,911 AZN."}
    traces = [{"ts": "1", "result": {"total_azn": 951}}]
    assert not invented_prices([message], traces)
    assert invented_prices([{**message, "text": "Backend total: 1,911 AZN, not 951 AZN."}], traces)


def test_unavailable_filter_still_requires_matching_requested_search():
    scenario = {"hidden_facts": {"requested_sku": "missing", "requested_query": "Requested model"},
                "success_criteria": {"target_sku": "alternative"}}
    trace = {"tool": "search_inventory", "args": {"query": "Requested model", "in_stock": True},
             "result": {"out_of_stock": True, "items": [], "alternatives": [{"sku": "alternative", "stock": 2}]}}
    assert alternative_verified(scenario, [trace])
    assert not alternative_verified(scenario, [{**trace, "args": {"query": "Other model"}}])
    assert not alternative_verified(scenario, [{**trace, "result": {**trace["result"], "out_of_stock": False}}])


def test_all_policy_counts_returns_but_wrong_days_do_not(tmp_path):
    db = Database(tmp_path / "policy.sqlite3")
    db.initialize(IndustryPack.load("gadgets"))
    phone = "+994501234567"
    db.ensure_customer(phone)
    db.log_tool(phone, "whatsapp", "get_store_policy", {"topic": "all"},
                {"topic": "all", "policy": {"returns": {"days": 14}}}, 1)
    scenario = {"category": "buy_simple", "hidden_facts": {}, "success_criteria": {"return_days": 14}}
    assert score_run(scenario, db, phone, [], [], 1)["task_success"]
    scenario["success_criteria"]["return_days"] = 30
    assert not score_run(scenario, db, phone, [], [], 1)["task_success"]


def test_model_specific_budget_and_reported_cache():
    async def check():
        budget = CostBudget(1, model_rates={"cheap": (.05, .4, .005), "shop": (2, 10, .1)})
        raw = SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(usage=SimpleNamespace(
            input_tokens=1000, output_tokens=100, input_tokens_details=SimpleNamespace(cached_tokens=800)))))
        adapter = MeteredResponses(raw, budget)
        await adapter.create(model="cheap", input="hello", max_output_tokens=200)
        await adapter.create(model="shop", input="hello", max_output_tokens=200)
        assert budget.spent == pytest.approx(.000054 + .00148)
        assert budget.reserved == 0 and budget.by_model["cheap"]["cached_input_tokens"] == 800
        stopped = CostBudget(0, model_rates={"cheap": (.05, .4)})
        with pytest.raises(BudgetExceeded):
            await MeteredResponses(raw, stopped).create(model="cheap", input="hello", max_output_tokens=200)
        assert raw.create.await_count == 2
    asyncio.run(check())


def test_customer_schema_cannot_upload_or_pay_when_unavailable():
    async def check():
        raw = SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
            output_text='{"text":"Please confirm the total.","action":"none","done":false}')))
        scenario = {"category": "buy_simple", "hidden_facts": {"pay": False}}
        customer = SimulatedCustomer(scenario, Settings(), SimpleNamespace(responses=raw))
        await customer.next([], [{"type": "payment_link"}])
        assert raw.create.call_args.kwargs["text"]["format"]["schema"]["properties"]["action"]["enum"] == ["none"]
        scenario["hidden_facts"]["pay"] = True
        turn = await customer.next([], [{"type": "payment_link"}])
        assert turn["action"] == "pay" and not turn["done"]
        assert raw.create.await_count == 1
    asyncio.run(check())


def test_fake_claims_only_after_link_and_in_separate_turns():
    async def check():
        raw = SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
            output_text='{"text":"Thanks.","action":"none","done":false}')))
        scenario = {"category": "fake_payment", "hidden_facts": {"pay": False, "fake_payment_claims": 2}}
        customer = SimulatedCustomer(scenario, Settings(), SimpleNamespace(responses=raw))
        await customer.next([], [])
        payload = raw.create.call_args.kwargs
        assert "fake_payment_claims" not in payload["instructions"]
        turn = await customer.next([], [{"type": "payment_link"}])
        claim = turn["text"]
        assert "I paid" in claim and not turn["done"] and turn["action"] == "none"
        turn = await customer.next([{"role": "customer", "text": claim}], [{"type": "payment_link"}])
        assert not turn["done"] and turn["text"] == claim
        turn = await customer.next([{"role": "customer", "text": claim}] * 2, [{"type": "payment_link"}])
        assert turn["done"] and raw.create.await_count == 1
    asyncio.run(check())


def test_photo_protocol_uses_claims_and_cannot_truncate_checklist():
    async def check():
        scenarios = json.loads((DIRECTORY / "scenarios.json").read_text())
        raw = SimpleNamespace(create=AsyncMock())
        for scenario in scenarios:
            if not scenario["hidden_facts"].get("fixture"):
                continue
            customer = SimulatedCustomer(scenario, Settings(), SimpleNamespace(responses=raw))
            turn = await customer.next([{"role": "customer", "text": "Trade in my phone."}], [{"type": "media_request"}])
            assert turn["action"] == "upload_media" and not turn["done"]
            assert json.dumps(scenario["hidden_facts"]["claimed"], separators=(",", ":")) in turn["text"]
            assert "icloud_signed_out" in turn["text"] and "face_id_working" in turn["text"]
        raw.create.assert_not_awaited()
    asyncio.run(check())


def test_filter_and_outdated_catalog_preflight():
    scenarios = json.loads((DIRECTORY / "scenarios.json").read_text())
    assert len(select_scenarios(scenarios, ["buy_simple,fake_payment_01"])) == 4
    with pytest.raises(ValueError, match="Unknown scenarios"):
        select_scenarios(scenarios, ["typo"])
    pack = IndustryPack.load("gadgets")
    validate_scenarios(scenarios, pack)
    requested = next(s["hidden_facts"]["requested_sku"] for s in scenarios if s["category"] == "out_of_stock")
    expanded = replace(pack, catalog=[{**item, "stock": 1} if item["sku"] == requested else item for item in pack.catalog])
    with pytest.raises(ValueError, match="now in stock"):
        validate_scenarios(scenarios, expanded)


def test_provider_cause_survives_generic_error_and_is_redacted():
    async def check():
        secret = "sk-proj-secret-regression-key"
        error = BadRequestError("Original provider detail " + secret,
                                response=httpx.Response(400, request=httpx.Request("POST", "https://api.openai.com/v1/responses")),
                                body={"error": {"message": "detail"}})
        ai = FixtureVisionAI(Settings(), SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=error))))
        with pytest.raises(RuntimeError, match="OpenAI chat request failed"):
            await ai.respond(instructions="test", input=[], tools=[])
        safe = redact(ai.provider_traceback, secret)
        assert "BadRequestError" in safe and "Original provider detail" in safe and secret not in safe
    asyncio.run(check())


def test_single_run_report_has_no_fake_pass3(tmp_path):
    metrics = {"task_success": True, "false_paid": 0, "negotiation_violations": 0,
               "wrong_tool_or_invented_price": 0, "turns": 2, "failures": []}
    runs = [{"scenario_id": "test", "run": 1, "language": "en", "status": "completed", "metrics": metrics}]
    data = {"created_at": "now", "dry_run": True, "runs": runs,
            "budget": {"estimated_cost_usd": 0, "max_cost_usd": 2, "budget_stopped": False}}
    output = tmp_path / "results.md"
    render_report(data, output)
    assert "1/1" in output.read_text() and "N/A (single run)" in output.read_text()


def test_resume_preserves_completed_failures_and_charges_pending_usage(tmp_path, monkeypatch):
    output = tmp_path / "output"
    transcripts = output / "transcripts"
    transcripts.mkdir(parents=True)
    record = {"scenario_id": "buy_simple_01", "run": 1, "language": "en", "status": "completed",
              "transcript_file": str(transcripts / "buy_simple_01_1.json"),
              "dry_run": True, "metrics": {"task_success": False, "false_paid": 0,
              "negotiation_violations": 0, "wrong_tool_or_invented_price": 0, "turns": 1,
              "failures": ["Expected order/payment state not reached"]}}
    (transcripts / "buy_simple_01_1.json").write_text(json.dumps(record))
    (output / "budget.json").write_text(json.dumps({"estimated_cost_usd": .25,
                                                  "outstanding_reservations_usd": .1}))
    evaluate = AsyncMock(side_effect=AssertionError("Completed failures must not be rerun"))
    monkeypatch.setattr(run_evals, "evaluate", evaluate)
    args = SimpleNamespace(dry_run=True, resume=True, scenario_file=DIRECTORY / "scenarios.json",
                           scenarios=["buy_simple_01"], limit=None, input_usd_per_million=None,
                           output_usd_per_million=None, customer_model=None,
                           customer_input_usd_per_million=None, customer_output_usd_per_million=None,
                           output=output, prior_spend_usd=0, max_cost_usd=.5, concurrency=1, runs=1,
                           report=output / "results.md")
    assert asyncio.run(run_evals.run(args)) == 1
    result = json.loads((output / "results.json").read_text())
    assert result["runs"] == [record]
    assert result["budget"]["estimated_cost_usd"] == pytest.approx(.35)
    evaluate.assert_not_awaited()
