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
from uuid import uuid4

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx
from openai import AsyncOpenAI

from backend.config import Settings
from backend.db import now_iso
from backend.evals.budget import CostBudget, MeteredResponses
from backend.evals.customer import SimulatedCustomer
from backend.evals.fixtures import DIRECTORY, FixtureVisionAI
from backend.evals.mock_ai import MockCustomer, MockShopAI
from backend.evals.report import render_report
from backend.evals.scoring import score_run
from backend.main import create_app


def token_rates(model, input_rate=None, output_rate=None):
    if model == "gpt-6.1-sol":
        return (2.0 if input_rate is None else input_rate, 10.0 if output_rate is None else output_rate)
    if input_rate is None or output_rate is None:
        raise ValueError("Set --input-usd-per-million and --output-usd-per-million for the overridden model")
    return input_rate, output_rate


def empty_metrics(reason):
    return {"task_success": False, "negotiation_violations": 0, "false_paid": 0, "lie_detected": None,
            "correct_handoff": None, "wrong_tool_or_invented_price": 0, "turns": 0,
            "tool_latencies_ms": [], "median_tool_latency_ms": None, "p90_tool_latency_ms": None,
            "failures": [reason]}


def safe_error(error, api_key):
    message = str(error)
    if api_key:
        message = message.replace(api_key, "[redacted]")
    message = re.sub(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]+", "[redacted]", message)
    return f"{type(error).__name__}: {message[:1000]}"


async def evaluate(scenario, run, settings, budget, dry_run, output):
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
                           database_path=Path(temporary) / "run.sqlite3", upload_dir=Path(temporary) / "media")
        if dry_run:
            shop = MockShopAI(isolated, scenario)
            customer = MockCustomer(scenario)
        else:
            sdk = AsyncOpenAI(api_key=settings.api_key, timeout=45, max_retries=0)
            sdk.responses = MeteredResponses(sdk.responses, budget)
            shop = FixtureVisionAI(isolated, sdk)
            customer = SimulatedCustomer(scenario, settings, sdk)
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
                    record["status"] = "budget_stopped" if budget.stopped else "error"
                    # Safe adapter errors contain no key; never serialize SDK/client objects.
                    record["error"] = safe_error(error, settings.api_key)
                record["metrics"] = score_run(scenario, db, phone, record["payment_calls"], record["transcript"], turns)
                if record.get("error"):
                    record["metrics"]["task_success"] = False
                    record["metrics"]["failures"].append(record["error"])
        # Transcripts contain the final DB snapshot/traces; temporary DB and media are removed.
    transcript_file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{scenario['id']} run {run}: {record['status']}, success={record['metrics']['task_success']}, turns={turns}", flush=True)
    return record


async def run(args):
    settings = Settings.from_env()
    if not args.dry_run and not settings.api_key:
        raise ValueError("Set OPENAI_API_KEY in backend/.env, or use --dry-run")
    scenarios = json.loads(args.scenarios.read_text())
    if args.limit:
        scenarios = scenarios[:args.limit]
    rates = token_rates(settings.chat_model, args.input_usd_per_million, args.output_usd_per_million)
    budget = CostBudget(args.max_cost_usd, *rates)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "transcripts").mkdir(exist_ok=True)
    semaphore = asyncio.Semaphore(args.concurrency)

    async def bounded(scenario, index):
        async with semaphore:
            return await evaluate(scenario, index, settings, budget, args.dry_run, args.output)

    records = await asyncio.gather(*(bounded(scenario, index) for scenario in scenarios for index in range(1, 4)))
    data = {"created_at": now_iso(), "dry_run": args.dry_run, "model": settings.chat_model,
            "vision_mocked": True, "budget": budget.summary(), "runs": records}
    (args.output / "results.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    render_report(data, args.report)
    print(f"Report: {args.report}; estimated cost ${budget.spent:.6f}; cap stopped={budget.stopped}")
    return 2 if budget.stopped else 1 if any(not record["metrics"]["task_success"] for record in records) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Mock OpenAI providers; real API/tools/DB still execute")
    parser.add_argument("--limit", type=int, help="First N scenarios, each run three times")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--max-cost-usd", type=float, default=5)
    parser.add_argument("--input-usd-per-million", type=float, default=float(os.environ["EVAL_INPUT_USD_PER_MILLION"]) if os.getenv("EVAL_INPUT_USD_PER_MILLION") else None)
    parser.add_argument("--output-usd-per-million", type=float, default=float(os.environ["EVAL_OUTPUT_USD_PER_MILLION"]) if os.getenv("EVAL_OUTPUT_USD_PER_MILLION") else None)
    parser.add_argument("--scenarios", type=Path, default=DIRECTORY / "scenarios.json")
    parser.add_argument("--output", type=Path, default=DIRECTORY / "output")
    parser.add_argument("--report", type=Path, default=DIRECTORY / "results.md")
    args = parser.parse_args()
    if args.concurrency < 1 or args.limit is not None and args.limit < 1:
        parser.error("Concurrency and limit must be positive")
    try:
        code = asyncio.run(run(args))
    except ValueError as error:
        parser.error(str(error))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
