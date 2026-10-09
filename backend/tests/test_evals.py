import asyncio
from collections import Counter
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.config import Settings
from backend.db import dumps, now_iso
from backend.evals.budget import BudgetExceeded, CostBudget, MeteredResponses
from backend.evals.fixtures import DIRECTORY
from backend.evals.report import render_report
from backend.evals.run_evals import evaluate, safe_error
from backend.evals.scoring import invented_prices, score_run
from backend.evals.vision_eval import read_labels, summarize
from backend.tests.test_api import PHONE


def test_scenarios_cover_languages_and_categories():
    scenarios = json.loads((DIRECTORY / "scenarios.json").read_text())
    assert len(scenarios) == 30 and len({scenario["id"] for scenario in scenarios}) == 30
    assert Counter(scenario["language"] for scenario in scenarios) == {"en": 25, "ru": 3, "az": 2}
    assert len({scenario["category"] for scenario in scenarios}) == 10
    assert set(Counter(scenario["category"] for scenario in scenarios).values()) == {3}


def test_budget_blocks_provider_before_call_and_counts_usage():
    async def check():
        raw = SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(usage=SimpleNamespace(input_tokens=10, output_tokens=5))))
        empty = CostBudget(0)
        with pytest.raises(BudgetExceeded):
            await MeteredResponses(raw, empty).create(input="hello", max_output_tokens=100)
        raw.create.assert_not_awaited()
        budget = CostBudget(1)
        await MeteredResponses(raw, budget).create(input="hello", max_output_tokens=100)
        assert budget.calls == 1 and budget.input_tokens == 10 and budget.output_tokens == 5
        assert budget.spent == pytest.approx(.00007) and budget.reserved == 0
    asyncio.run(check())


def test_concurrent_reservations_cannot_overspend_cap():
    async def check():
        budget = CostBudget(.003)
        attempts = await asyncio.gather(*(budget.reserve({"input": "small", "max_output_tokens": 100}) for _ in range(4)), return_exceptions=True)
        assert sum(isinstance(result, BudgetExceeded) for result in attempts) == 3
        assert sum(isinstance(result, float) for result in attempts) == 1
        assert budget.reserved + budget.spent <= budget.maximum
        assert budget.stopped
    asyncio.run(check())


def test_price_grader_uses_only_earlier_tool_amounts():
    message = {"id": "m1", "ts": "2026-10-09T12:00:00Z", "from": "agent", "type": "text", "text": "The price is 1,399.00 AZN."}
    prior = {"ts": "2026-10-09T11:00:00Z", "result": {"items": [{"price_azn": 1399, "storage": 128}]}}
    assert not invented_prices([message], [prior])
    assert invented_prices([{**message, "text": "The offer is 128 AZN."}], [prior])  # storage is not a price
    assert invented_prices([message], [{**prior, "ts": "2026-10-09T13:00:00Z"}])
    assert not invented_prices([{**message, "text": "Your budget is 1500 AZN."}], [])


def test_state_grader_detects_false_paid_and_excessive_offer(db):
    with db.connection(write=True) as connection:
        connection.execute("INSERT INTO analyses VALUES (?, ?, ?, ?, ?)", ("a", PHONE, now_iso(), "[]", "{}"))
        calculation = {"final_offer": 300, "base_offer": 480}
        connection.execute("INSERT INTO quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("q", PHONE, now_iso(), "a", "{}", dumps(calculation), 40000, 0))
        connection.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("bad-order", PHONE, now_iso(), "[]", None, dumps({"district": "pickup"}), 100, "paid", None, None))
        connection.execute("INSERT INTO payments VALUES (?, ?, ?, ?)", ("bad-order", "paid", now_iso(), now_iso()))
    db.log_tool(PHONE, "whatsapp", "negotiate_offer", {"customer_ask": 400}, {"quote_id": "q", "new_offer": 400, "max_offer": 500}, 1)
    scenario = {"category": "fake_payment", "success_criteria": {}, "hidden_facts": {}}
    metrics = score_run(scenario, db, PHONE, [], [], 1)
    assert metrics["negotiation_violations"] == 1 and metrics["false_paid"] == 1
    assert not metrics["task_success"]


def test_report_selects_five_real_failures_and_labels_dry_run(tmp_path):
    metrics = {"task_success": False, "false_paid": 0, "negotiation_violations": 0, "lie_detected": None,
               "correct_handoff": None, "wrong_tool_or_invented_price": 1, "turns": 2, "tool_latencies_ms": [1, 9], "failures": ["Invented price"]}
    runs = [{"scenario_id": f"s{i}", "run": 1, "language": "en", "status": "completed", "metrics": metrics,
             "transcript_file": str(tmp_path / f"s{i}_1.json")} for i in range(8)]
    destination = tmp_path / "report.md"
    render_report({"created_at": now_iso(), "dry_run": True, "runs": runs,
        "budget": {"estimated_cost_usd": 0, "max_cost_usd": 5, "budget_stopped": False}}, destination)
    text = destination.read_text()
    assert "pipeline validation only" in text and text.count("): Invented price") == 5
    assert "Baseline comparison" in text and "incomplete" in text


def test_empty_photo_labels_and_unknown_predictions(tmp_path):
    (tmp_path / "labels.csv").write_text("file,model,storage,battery_health,screen_cracked,back_cracked\n")
    assert read_labels(tmp_path) == []
    assert summarize([])["retake_rate"] is None
    truth = {"model": "iPhone 13", "storage": 128, "battery_health": 79, "screen_cracked": True, "back_cracked": False}
    result = summarize([{"truth": truth, "prediction": {**truth, "screen_cracked": None, "need_retake": True, "confidence": .2}}])
    assert result["crack_confusion"]["screen_cracked"]["unknown"] == 1
    assert result["per_field_accuracy"]["screen_cracked"]["accuracy"] == 0
    assert result["retake_rate"] == 1


def test_safe_errors_redact_keys():
    secret = "sk-proj-verysecret012345678901234567890"
    assert secret not in safe_error(RuntimeError("Incorrect key: " + secret), secret)


def test_dry_tradein_and_fake_payment_use_real_routes(tmp_path):
    async def check():
        scenarios = json.loads((DIRECTORY / "scenarios.json").read_text())
        output = tmp_path / "output"
        (output / "transcripts").mkdir(parents=True)
        chosen = [scenario for scenario in scenarios if scenario["id"] in ("tradein_lying_01", "fake_payment_01")]
        runs = await asyncio.gather(*(evaluate(scenario, 1, Settings(), CostBudget(0), True, output) for scenario in chosen))
        assert all(run["metrics"]["task_success"] for run in runs)
        assert runs[0]["phone"] != runs[1]["phone"]
        assert all(Path(run["transcript_file"]).exists() for run in runs)
        assert not list(output.glob("state-*"))
    asyncio.run(check())
