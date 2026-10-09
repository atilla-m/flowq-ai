import argparse
import asyncio
import csv
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx
from openai import AsyncOpenAI

from backend.ai import AIClient
from backend.config import Settings
from backend.db import now_iso
from backend.evals.budget import CostBudget, MeteredResponses
from backend.evals.fixtures import DIRECTORY
from backend.evals.run_evals import safe_error, token_rates
from backend.main import create_app
from backend.tools.common import normalize_text

FIELDS = ("model", "storage", "battery_health", "screen_cracked", "back_cracked")


def boolean(value):
    if value.strip().lower() in ("true", "1", "yes"):
        return True
    if value.strip().lower() in ("false", "0", "no"):
        return False
    raise ValueError(f"Invalid crack label: {value!r}")


def read_labels(photos):
    with (photos / "labels.csv").open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != ["file", *FIELDS]:
            raise ValueError("labels.csv must use the exact documented header")
        rows = []
        for row in reader:
            if not any(row.values()):
                continue
            truth = {"model": row["model"], "storage": int(row["storage"]), "battery_health": int(row["battery_health"]),
                     "screen_cracked": boolean(row["screen_cracked"]), "back_cracked": boolean(row["back_cracked"])}
            if not truth["model"] or not 0 <= truth["battery_health"] <= 100 or truth["storage"] <= 0:
                raise ValueError("Invalid model/storage/battery label")
            paths = []
            # A row can name one image, a case directory, or four pipe-separated images.
            for filename in row["file"].split("|"):
                path = (photos / filename).resolve()
                if not path.is_relative_to(photos.resolve()):
                    raise ValueError("Photo paths must stay inside the photos directory")
                paths.extend(sorted(p for p in path.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")) if path.is_dir() else [path])
            if not paths or len(paths) > 8 or any(not path.is_file() for path in paths):
                raise ValueError("Each row must name one to eight existing images")
            rows.append({"file": row["file"], "truth": truth, "paths": paths})
    return rows


def summarize(records):
    completed = [record for record in records if "prediction" in record]
    accuracy = {}
    for field in FIELDS:
        correct = sum((normalize_text(record["prediction"].get(field) or "") == normalize_text(record["truth"][field]))
                      if field == "model" else record["prediction"].get(field) == record["truth"][field] for record in completed)
        accuracy[field] = {"correct": correct, "total": len(completed), "accuracy": correct / len(completed) if completed else None}
    confusion = {}
    for field in ("screen_cracked", "back_cracked"):
        table = {"true_positive": 0, "true_negative": 0, "false_positive": 0, "false_negative": 0, "unknown": 0}
        for record in completed:
            observed, truth = record["prediction"].get(field), record["truth"][field]
            key = "unknown" if not isinstance(observed, bool) else "true_positive" if observed and truth else \
                "true_negative" if not observed and not truth else "false_positive" if observed else "false_negative"
            table[key] += 1
        confusion[field] = table
    return {"cases": len(records), "completed": len(completed), "per_field_accuracy": accuracy,
            "crack_confusion": confusion,
            "retake_rate": sum(bool(record["prediction"].get("need_retake")) for record in completed) / len(completed) if completed else None,
            "low_confidence_rate": sum(record["prediction"].get("confidence", 0) < .7 for record in completed) / len(completed) if completed else None}


async def run(args):
    rows = read_labels(args.photos)
    settings = Settings.from_env()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    rates = token_rates(settings.vision_model, args.input_usd_per_million, args.output_usd_per_million)
    budget = CostBudget(args.max_cost_usd, *rates)
    if rows:
        if not settings.api_key:
            raise ValueError("Set OPENAI_API_KEY before evaluating labeled real photos")
        with tempfile.TemporaryDirectory(prefix="vision-state-", dir=args.output) as temporary:
            isolated = replace(settings, database_path=Path(temporary) / "vision.sqlite3", upload_dir=Path(temporary) / "media")
            sdk = AsyncOpenAI(api_key=settings.api_key, timeout=45, max_retries=0)
            sdk.responses = MeteredResponses(sdk.responses, budget)
            app = create_app(isolated, ai=AIClient(isolated, sdk))
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://vision.eval") as client:
                    for index, row in enumerate(rows):
                        record = {"file": row["file"], "truth": row["truth"]}
                        records.append(record)
                        if budget.stopped:
                            record["error"] = "Cost cap reached; case skipped"
                            continue
                        phone = f"+994990{index:06d}"
                        try:
                            ids = []
                            for path in row["paths"]:
                                upload = await client.post("/api/media", data={"phone": phone}, files={"file": (path.name, path.read_bytes())})
                                upload.raise_for_status()
                                ids.append(upload.json()["media_id"])
                            response = await client.post("/api/tools/analyze_device_media", json={"phone": phone,
                                "channel": "whatsapp", "args": {"media_ids": ids, "claimed": {}}})
                            response.raise_for_status()
                            prediction = response.json()["result"]
                            if prediction.get("error"):
                                record["error"] = prediction["message"]
                            else:
                                record["prediction"] = prediction
                        except Exception as error:
                            record["error"] = safe_error(error, settings.api_key)
    data = {"created_at": now_iso(), "summary": summarize(records), "budget": budget.summary(), "cases": records}
    (args.output / "vision_results.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))
    summary = data["summary"]
    lines = ["# FlowQ vision eval", "", f"Completed cases: {summary['completed']} / {summary['cases']}", "",
             "| Field | Correct / total | Accuracy |", "| --- | --- | --- |"]
    for field, metric in summary["per_field_accuracy"].items():
        accuracy = f"{metric['accuracy']:.1%}" if metric["accuracy"] is not None else "N/A"
        lines.append(f"| {field} | {metric['correct']}/{metric['total']} | {accuracy} |")
    lines += ["", "| Crack field | TP | TN | FP | FN | Unknown |", "| --- | --- | --- | --- | --- | --- |"]
    for field, confusion in summary["crack_confusion"].items():
        lines.append(f"| {field} | " + " | ".join(str(value) for value in confusion.values()) + " |")
    for key in ("retake_rate", "low_confidence_rate"):
        lines.append(f"\n{key}: " + (f"{summary[key]:.1%}" if summary[key] is not None else "N/A"))
    if not rows:
        lines += ["", "No labeled real photos yet. Fill photos/labels.csv; this is not an accuracy measurement."]
    (args.output / "vision_results.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(summary, indent=2))
    return 2 if budget.stopped else 1 if any("error" in record for record in records) else 0


def main():
    parser = argparse.ArgumentParser(description="Evaluate real device photos separately from agent behavior")
    parser.add_argument("--photos", type=Path, default=DIRECTORY / "photos")
    parser.add_argument("--output", type=Path, default=DIRECTORY / "output")
    parser.add_argument("--max-cost-usd", type=float, default=5)
    parser.add_argument("--input-usd-per-million", type=float)
    parser.add_argument("--output-usd-per-million", type=float)
    args = parser.parse_args()
    try:
        code = asyncio.run(run(args))
    except ValueError as error:
        parser.error(str(error))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
