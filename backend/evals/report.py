import argparse
import json
from pathlib import Path
import statistics
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.evals.scoring import percentile

DIRECTORY = Path(__file__).resolve().parent


def percentage(values):
    return f"{sum(values) / len(values):.1%}" if values else "N/A"


def number(value):
    return f"{value:.2f}" if value is not None else "N/A"


def render_report(data, destination):
    runs = data["runs"]
    evaluated = [run for run in runs if run["status"] in ("completed", "max_turns", "error")]
    groups = {}
    for run in runs:
        groups.setdefault(run["scenario_id"], []).append(run)
    pass3 = [all(run["metrics"]["task_success"] for run in group)
             for group in groups.values() if len(group) == 3 and all(run in evaluated for run in group)]
    latencies = [latency for run in runs for latency in run["metrics"].get("tool_latencies_ms", [])]
    lies = [run["metrics"]["lie_detected"] for run in evaluated if run["metrics"].get("lie_detected") is not None]
    handoffs = [run["metrics"]["correct_handoff"] for run in evaluated if run["metrics"].get("correct_handoff") is not None]
    title = "DRY RUN — scripted providers; pipeline validation only" if data["dry_run"] else "LIVE — simulated customers and real shop model; fixture vision mocked"
    lines = ["# FlowQ eval results", "", title, "", f"Created: {data['created_at']}", "",
        "Dry-run success is not evidence of LLM sales quality. Live behavior scores measure the chat agent; real-image accuracy is measured separately by vision_eval.py.", "",
        "## Summary", "", "| Metric | Result |", "| --- | --- |",
        f"| Runs evaluated / planned | {len(evaluated)} / {len(runs)} |",
        f"| Task success | {percentage([run['metrics']['task_success'] for run in evaluated])} |",
        f"| pass^3 (all three runs pass) | {percentage(pass3)} ({len(pass3)} fully evaluated scenarios) |",
        f"| Negotiation violations | {sum(run['metrics']['negotiation_violations'] for run in runs)} |",
        f"| False paid (DB paid without endpoint) | {sum(run['metrics']['false_paid'] for run in runs)} |",
        f"| Lie detected and communicated | {percentage(lies)} |",
        f"| Correct handoff | {percentage(handoffs)} |",
        f"| Wrong tool / invented price flags | {sum(run['metrics']['wrong_tool_or_invented_price'] for run in runs)} |",
        f"| Median customer turns | {number(statistics.median([run['metrics']['turns'] for run in evaluated]) if evaluated else None)} |",
        f"| Median tool latency (ms) | {number(statistics.median(latencies) if latencies else None)} |",
        f"| p90 tool latency (ms) | {number(percentile(latencies, .9))} |",
        f"| Estimated API cost (USD) | {data['budget']['estimated_cost_usd']:.6f} |",
        f"| Cost cap / stopped | {data['budget']['max_cost_usd']:.2f} / {data['budget']['budget_stopped']} |", "",
        "## Scenarios", "", "| Scenario | Language | Completed | Task success | pass^3 |", "| --- | --- | --- | --- | --- |"]
    for scenario_id, group in sorted(groups.items()):
        measured = [run for run in group if run in evaluated]
        all3 = "yes" if len(measured) == 3 and all(run["metrics"]["task_success"] for run in measured) else "no" if len(measured) == 3 else "incomplete"
        lines.append(f"| {scenario_id} | {group[0]['language']} | {len(measured)}/3 | {percentage([run['metrics']['task_success'] for run in measured])} | {all3} |")
    lines += ["", "## Baseline comparison", "", "Fill this table with measured shop-hotline results before using it in a pitch.", "",
        "| Shop hotline / service | Minutes to reach a human | Menu steps | Trade-in quote possible by phone (yes/no) |",
        "| --- | --- | --- | --- |", "| Shop hotline 1 | | | |", "| Shop hotline 2 | | | |", "| FlowQ | | | |", "",
        "## Failures", ""]
    failed = sorted((run for run in runs if not run["metrics"]["task_success"] and run["status"] != "budget_skipped"),
                    key=lambda run: (-(run["metrics"]["negotiation_violations"] + run["metrics"]["false_paid"]), run["scenario_id"], run["run"]))[:5]
    if not failed:
        lines.append("No failed transcripts in this run. No failure examples were fabricated.")
    for run in failed:
        reason = "; ".join(run["metrics"]["failures"]) or run.get("error", "Scenario incomplete")
        path = Path(run["transcript_file"])
        try:
            target = path.relative_to(destination.parent)
        except ValueError:
            target = path
        lines.append(f"- [{run['scenario_id']} run {run['run']}]({target}): {reason.replace(chr(10), ' ')}")
    lines += ["", "## Measurement notes", "",
        "Task success uses persisted orders, quotes, events and tool traces plus visible replies. pass^3 is the fraction of fully evaluated scenarios whose three runs all pass; budget-skipped scenarios are incomplete, not successes. Price flags use currency/price expressions and only earlier tool-returned amounts; manual review is needed for unrecognized phrasing. Fixed backend notices also count as customer-visible mismatch communication. Tool latency includes local dispatch and provider latency where applicable; synthetic vision contributes no real vision latency.", ""]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines), encoding="utf-8")
    return destination


def main():
    parser = argparse.ArgumentParser(description="Build the pitch-ready eval report")
    parser.add_argument("--input", type=Path, default=DIRECTORY / "output/results.json")
    parser.add_argument("--output", type=Path, default=DIRECTORY / "results.md")
    args = parser.parse_args()
    if not args.input.exists():
        parser.error("No results file. Run run_evals.py first.")
    render_report(json.loads(args.input.read_text()), args.output)
    print(args.output)


if __name__ == "__main__":
    main()
