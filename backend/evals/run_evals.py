"""One-command evals: isolated app instances, real HTTP route dispatch, no demo DB writes."""
import argparse
import asyncio
from dataclasses import replace
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import traceback
from uuid import uuid4

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx
from openai import AsyncOpenAI

from backend.config import Settings
from backend.db import now_iso
from backend.evals.budget import BudgetExceeded, CostBudget, MeteredResponses
from backend.evals.customer import SimulatedCustomer
from backend.evals.fixtures import DIRECTORY, FixtureVisionAI
from backend.evals.mock_ai import MockCustomer, MockShopAI
from backend.evals.report import render_report
from backend.evals.scoring import score_run
from backend.main import create_app
from backend.pack import IndustryPack

# Standard text rates checked against official model pages on 2026-10-09.
# (input, output, cached input), USD per million. Unknown models need overrides.
MODEL_RATES = {"gpt-6.1-sol": (2.0, 10.0, .10), "gpt-5-nano": (.05, .40, .005),
               "gpt-4.1-nano": (.10, .40, .025), "gpt-4o-mini": (.15, .60, .075),
               "gpt-5.4-nano": (.20, 1.25, .02), "gpt-5.6-luna": (.20, 1.20, .02),
               "gpt-6-luna": (.10, .50, .01)}


def token_rates(model, input_rate=None, output_rate=None):
    if model in MODEL_RATES:
        return (MODEL_RATES[model][0] if input_rate is None else input_rate,
                MODEL_RATES[model][1] if output_rate is None else output_rate)
    if input_rate is None or output_rate is None:
        raise ValueError("Set --input-usd-per-million and --output-usd-per-million for the overridden model")
    return input_rate, output_rate


def empty_metrics(reason):
    return {"task_success": False, "negotiation_violations": 0, "false_paid": 0, "lie_detected": None,
            "correct_handoff": None, "wrong_tool_or_invented_price": 0, "turns": 0,
            "tool_latencies_ms": [], "median_tool_latency_ms": None, "p90_tool_latency_ms": None,
            "failures": [reason]}


def redact(message, api_key):
    if api_key:
        message = message.replace(api_key, "[redacted]")
    message = re.sub(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]+", "[redacted]", message)
    return message


def safe_error(error, api_key):
    return f"{type(error).__name__}: {redact(str(error), api_key)[:1000]}"


def select_scenarios(scenarios, filters):
    if not filters:
        return scenarios
    tokens = [token.strip() for value in filters for token in value.split(",") if token.strip()]
    missing = [token for token in tokens if not any(token in (s["id"], s["category"]) for s in scenarios)]
    if missing:
        raise ValueError("Unknown scenarios/categories: " + ", ".join(missing))
    return [s for s in scenarios if s["id"] in tokens or s["category"] in tokens]


def validate_scenarios(scenarios, pack):
    catalog = {item["sku"]: item for item in pack.catalog}
    for scenario in scenarios:
        facts = scenario["hidden_facts"]
        for field in ("target_sku", "requested_sku"):
            sku = facts.get(field)
            if sku and sku not in catalog:
                raise ValueError(f"Outdated scenario {scenario['id']}: unknown {field} {sku}")
        if scenario["success_criteria"].get("alternative_offered") and catalog[facts["requested_sku"]]["stock"] != 0:
            raise ValueError(f"Outdated scenario {scenario['id']}: requested SKU is now in stock")
        if facts.get("target_sku") and catalog[facts["target_sku"]]["stock"] <= 0:
            raise ValueError(f"Outdated scenario {scenario['id']}: target SKU is unavailable")


async def cheapest_customer_model(settings):
    async with AsyncOpenAI(api_key=settings.api_key, timeout=30, max_retries=0) as sdk:
        available = sorted(m.id for m in (await sdk.models.list()).data if m.id.startswith("gpt"))
    candidates = [model for model in MODEL_RATES if model in available]
    if not candidates:
        raise ValueError("No priced customer model available; set --customer-model and its rates")
    # Simulator input greatly exceeds output; gpt-5-nano dominates the other
    # available standard chat models on both uncached input and output prices.
    chosen = min(candidates, key=lambda model: (MODEL_RATES[model][0], MODEL_RATES[model][1]))
    return chosen, available


async def evaluate(scenario, run, settings, budget, dry_run, output, customer_model="gpt-5-nano"):
    phone = "+994" + str(int(uuid4().hex, 16) % 1_000_000_000).zfill(9)
    transcript_file = output / "transcripts" / f"{scenario['id']}_{run}.json"
    record = {"scenario_id": scenario["id"], "category": scenario["category"], "language": scenario["language"],
              "run": run, "phone": phone, "status": "budget_skipped" if budget.stopped else "completed",
              "dry_run": dry_run, "transcript_file": str(transcript_file), "transcript": [], "payment_calls": []}
    if budget.stopped:
        record["metrics"] = empty_metrics("Not started because the estimated cost cap was reached")
        transcript_file.write_text(json.dumps(record, ensure_ascii=False, indent=2))
        return record
    with tempfile.TemporaryDirectory(prefix="state-", dir=output) as temporary:
        isolated = replace(settings, api_key="" if dry_run else settings.api_key,
                           database_path=Path(temporary) / "run.sqlite3", upload_dir=Path(temporary) / "media",
                           demo_caller_phone="", twilio_account_sid="", twilio_auth_token="", twilio_phone_number="")
        if dry_run:
            shop = MockShopAI(isolated, scenario)
            customer = MockCustomer(scenario)
        else:
            sdk = AsyncOpenAI(api_key=settings.api_key, timeout=120, max_retries=0)
            sdk.responses = MeteredResponses(sdk.responses, budget)
            shop = FixtureVisionAI(isolated, sdk)
            customer = SimulatedCustomer(scenario, settings, sdk, customer_model)
        app = create_app(isolated, ai=shop)
        turns = 0
        async with app.router.lifespan_context(app):
            db = app.state.db
            db.ensure_customer(phone)
            if dry_run:
                shop.db, shop.phone = db, phone
            if scenario["hidden_facts"].get("prior_summary"):
                db.add_conversation(phone, "voice", scenario["hidden_facts"]["prior_summary"])
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://eval.local", timeout=120) as client:
                uploaded_ids, paid_orders = [], set()
                try:
                    for _ in range(12):
                        messages = (await client.get("/api/inbox", params={"phone": phone})).json()["messages"]
                        turn = await customer.next(record["transcript"], messages)
                        if turn["done"] and turn["action"] == "none":
                            break
                        record["transcript"].append({"role": "customer", "ts": now_iso(), "text": turn["text"], "action": turn["action"]})
                        media_ids = []
                        if turn["action"] == "upload_media":
                            if "fixture" not in scenario["hidden_facts"]:
                                raise ValueError("Simulator requested media in a non-trade-in scenario")
                            if not uploaded_ids:
                                fixture = shop.fixtures[scenario["hidden_facts"]["fixture"]]
                                for filename in fixture["files"]:
                                    response = await client.post("/api/media", data={"phone": phone},
                                        files={"file": (filename, (DIRECTORY / "fixtures" / filename).read_bytes(), "image/png")})
                                    response.raise_for_status()
                                    uploaded_ids.append(response.json()["media_id"])
                            media_ids = uploaded_ids
                        elif turn["action"] == "pay":
                            if not scenario["hidden_facts"].get("pay"):
                                raise ValueError("Simulator attempted forbidden payment")
                            links = [message["data"] for message in messages if message["type"] == "payment_link"]
                            if not links:
                                raise ValueError("Simulator attempted payment before receiving a link")
                            order_id = links[-1]["order_id"]
                            if order_id not in paid_orders:
                                response = await client.post(f"/api/payments/{order_id}/pay")
                                response.raise_for_status()
                                payment = {"order_id": order_id, "status": response.json()["status"], "ts": now_iso()}
                                record["payment_calls"].append(payment)
                                record["transcript"].append({"role": "action", "route": f"/api/payments/{order_id}/pay", **payment})
                                paid_orders.add(order_id)
                        response = await client.post("/api/chat", json={"phone": phone, "text": turn["text"], "media_ids": media_ids})
                        turns += 1
                        if response.status_code != 200:
                            raise RuntimeError(f"/api/chat HTTP {response.status_code}: {response.json().get('detail', 'request failed')}")
                        returned = response.json()["messages"]
                        finals = [message["text"] for message in returned if message["from"] == "agent" and message["type"] == "text"]
                        record["transcript"].append({"role": "agent", "ts": now_iso(), "text": finals[-1] if finals else "", "messages": returned})
                    else:
                        record["status"] = "max_turns"
                except Exception as error:
                    provider_trace = getattr(shop, "provider_traceback", None)
                    is_budget = isinstance(error, BudgetExceeded) or "Estimated cost cap reached" in str(error)
                    record["status"] = "budget_stopped" if is_budget else "error"
                    # Safe adapter errors contain no key; never serialize SDK/client objects.
                    record["error"] = safe_error(error, settings.api_key)
                    record["traceback"] = redact(provider_trace or traceback.format_exc(), settings.api_key)
                record["metrics"] = score_run(scenario, db, phone, record["payment_calls"], record["transcript"], turns)
                if record.get("error"):
                    record["metrics"]["task_success"] = False
                    if record["status"] == "budget_stopped":
                        record["metrics"]["failures"] = [record["error"]]
                    else:
                        record["metrics"]["failures"].append(record["error"])
        # Transcripts contain the final DB snapshot/traces; temporary DB and media are removed.
    transcript_file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{scenario['id']} run {run}: {record['status']}, success={record['metrics']['task_success']}, turns={turns}", flush=True)
    return record


async def run(args):
    settings = Settings.from_env()
    if not args.dry_run and not settings.api_key:
        raise ValueError("Set OPENAI_API_KEY in backend/.env, or use --dry-run")
    scenarios = select_scenarios(json.loads(args.scenario_file.read_text()), args.scenarios)
    if args.limit:
        scenarios = scenarios[:args.limit]
    rates = token_rates(settings.chat_model, args.input_usd_per_million, args.output_usd_per_million)
    validate_scenarios(scenarios, IndustryPack.load(settings.industry_pack))
    customer_model, available = (args.customer_model or "gpt-5-nano", []) if args.dry_run or args.customer_model else await cheapest_customer_model(settings)
    customer_rates = token_rates(customer_model, args.customer_input_usd_per_million, args.customer_output_usd_per_million)
    model_rates = {settings.chat_model: rates, customer_model: customer_rates}
    # Apply cache discounts only when the provider actually reports cached tokens
    # and the rates have not been overridden. Reservations assume uncached input.
    for model, pair in list(model_rates.items()):
        if model in MODEL_RATES and pair == MODEL_RATES[model][:2]:
            model_rates[model] = MODEL_RATES[model]
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "transcripts").mkdir(exist_ok=True)
    prior_spend = args.prior_spend_usd
    if args.resume and (args.output / "budget.json").exists():
        previous = json.loads((args.output / "budget.json").read_text())
        prior_spend = max(prior_spend, previous["estimated_cost_usd"] + previous.get("outstanding_reservations_usd", 0))
    budget = CostBudget(args.max_cost_usd, *rates, model_rates=model_rates,
                        checkpoint=args.output / "budget.json", initial_spent=prior_spend)
    semaphore = asyncio.Semaphore(args.concurrency)

    async def bounded(scenario, index):
        async with semaphore:
            existing = args.output / "transcripts" / f"{scenario['id']}_{index}.json"
            if args.resume and existing.exists():
                record = json.loads(existing.read_text())
                if record["dry_run"] != args.dry_run:
                    raise ValueError("Cannot resume results from a different live/dry-run mode")
                if record["status"] in ("completed", "max_turns"):
                    return record
                archive = args.output / "attempts"
                archive.mkdir(exist_ok=True)
                (archive / f"{scenario['id']}_{index}_{uuid4().hex}.json").write_text(existing.read_text())
            return await evaluate(scenario, index, settings, budget, args.dry_run, args.output, customer_model)

    print(f"Shop: {settings.chat_model}; customer: {customer_model}; {len(scenarios)} scenarios x {args.runs} runs; cap ${args.max_cost_usd:.2f}", flush=True)
    # Exercise every selected scenario before spending on later repeats.
    records = await asyncio.gather(*(bounded(scenario, index) for index in range(1, args.runs + 1) for scenario in scenarios))
    data = {"created_at": now_iso(), "dry_run": args.dry_run, "model": settings.chat_model,
            "customer_model": customer_model, "available_gpt_models": available, "runs_per_scenario": args.runs,
            "customer_protocol": "Model-generated ordinary replies; prescribed photo/payment/bargaining actions",
            "vision_mocked": True, "budget": budget.summary(), "runs": records}
    (args.output / "results.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    render_report(data, args.report)
    print(f"Report: {args.report}; estimated cost ${budget.spent:.6f}; cap stopped={budget.stopped}")
    return 2 if budget.stopped else 1 if any(not record["metrics"]["task_success"] for record in records) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Mock OpenAI providers; real API/tools/DB still execute")
    parser.add_argument("--resume", action="store_true", help="Keep completed records and carry forward checkpointed spend")
    parser.add_argument("--limit", type=int, help="First N scenarios after filtering")
    parser.add_argument("--runs", type=int, default=1, help="Runs per scenario (default: 1)")
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--max-cost-usd", type=float, default=5)
    parser.add_argument("--prior-spend-usd", type=float, default=0, help="Include earlier attempts in this invocation's cap")
    parser.add_argument("--input-usd-per-million", type=float, default=float(os.environ["EVAL_INPUT_USD_PER_MILLION"]) if os.getenv("EVAL_INPUT_USD_PER_MILLION") else None)
    parser.add_argument("--output-usd-per-million", type=float, default=float(os.environ["EVAL_OUTPUT_USD_PER_MILLION"]) if os.getenv("EVAL_OUTPUT_USD_PER_MILLION") else None)
    parser.add_argument("--scenario-file", type=Path, default=DIRECTORY / "scenarios.json")
    parser.add_argument("--scenarios", nargs="+", help="Scenario IDs or categories, space/comma separated")
    parser.add_argument("--customer-model", help="Override automatic cheapest available customer model")
    parser.add_argument("--customer-input-usd-per-million", type=float)
    parser.add_argument("--customer-output-usd-per-million", type=float)
    parser.add_argument("--output", type=Path, default=DIRECTORY / "output")
    parser.add_argument("--report", type=Path, default=DIRECTORY / "results.md")
    args = parser.parse_args()
    if args.concurrency < 1 or args.runs < 1 or args.limit is not None and args.limit < 1:
        parser.error("Concurrency, runs and limit must be positive")
    try:
        code = asyncio.run(run(args))
    except ValueError as error:
        parser.error(str(error))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
