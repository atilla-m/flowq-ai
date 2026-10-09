# Behavior and vision evals

Run from the repository root with the backend environment installed. Evals create fresh FastAPI app instances **in process**, using HTTPX's ASGI transport; they do not start a server or bind port 8000. Each run has an isolated temporary SQLite database, reset stock and a fresh phone. The demo database is never touched. Eval settings disable telephone credentials and the demo caller.

Before a live rerun, restart your separately running backend so it loads current prompts. The eval process reads prompts anew independently.

```bash
backend/.venv/bin/python backend/evals/run_evals.py --dry-run --runs 1 --max-cost-usd 0
# All 30 scenarios once, sharing a $2 customer + shop budget:
backend/.venv/bin/python backend/evals/run_evals.py --runs 1 --concurrency 1 --max-cost-usd 2 --output backend/evals/output/all
# Eight important scenarios, three repeats, sharing a separate $1.50 budget:
backend/.venv/bin/python backend/evals/run_evals.py --runs 3 --concurrency 1 --max-cost-usd 1.5 --scenarios buy_simple_01 buy_simple_02 tradein_honest_01 tradein_lying_01 tradein_lying_02 tradein_lying_03 negotiation_pushy_03 fake_payment_01 --output backend/evals/output/important
# Keep both suites in the final report; do not pool their denominators:
backend/.venv/bin/python backend/evals/report.py --input backend/evals/output/all/results.json backend/evals/output/important/results.json
backend/.venv/bin/python backend/evals/vision_eval.py --max-cost-usd 5
```

`--runs N` defaults to **1**. Concurrency defaults to **1** to avoid several full-output reservations consuming a tight cap at once. `--scenarios` accepts exact IDs or category names, space/comma separated, e.g. `--scenarios buy_simple,fake_payment_01`. Unknown filters fail before spending. `--scenario-file` selects a different JSON file; `--limit N` takes the first N scenarios after filtering. A catalog preflight rejects obsolete unknown SKUs, unavailable purchase targets, or out-of-stock scenarios whose requested SKU is now available, before spending. Current scenarios remain valid; no stock was changed to manufacture unavailability.

The 30 scenarios cover ten categories in **25 English, 3 Russian and 2 Azerbaijani** variants, with at most 12 customer turns. The live customer uses the cheapest priced chat model returned by your key's `/v1/models` list, currently **gpt-5-nano**. The shop continues using **CHAT_MODEL** through the production agent loop. Customer facts are private to the simulator. Response schemas restrict available actions, require checkout when a link arrives in paid scenarios, and issue fake payment claims and excessive bargaining demands in separate prescribed turns. Scoring criteria are never shown to the customer model. Payment/upload actions use the real routes; saying “I paid” never calls the payment endpoint. Earlier voice memory is seeded only for memory scenarios.

To avoid drift and truncated checklist replies in the cheapest model, fixture introductions, photo/checklist replies, quote acceptance, payment actions, fake-payment claims and bargaining demands have prescribed customer text. Fully prescribed turns make no customer-model request. Photo replies contain the scenario's **claimed** condition and all five checklist answers; the fixture truth remains private to photo interpretation. Ordinary buying replies remain model-generated, using low reasoning for GPT-5 nano, a 4096-token response cap, customer text capped at 500 characters, and a compact visible conversation. The simulator cannot pay in fake-payment cases. To override the ordinary-reply model, use `--customer-model` and, for unknown model prices, `--customer-input-usd-per-million` / `--customer-output-usd-per-million`. Shop overrides retain the existing `--input-usd-per-million` / `--output-usd-per-million` and environment variables.

Standard pricing checked on 2026-10-09 (USD per million text tokens):

| Model | Input | Output | Cached input | Official source |
| --- | --- | --- | --- | --- |
| gpt-5-nano | 0.05 | 0.40 | 0.005 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-5-nano) |
| gpt-4.1-nano | 0.10 | 0.40 | 0.025 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-nano) |
| gpt-4o-mini | 0.15 | 0.60 | 0.075 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| gpt-5.4-nano | 0.20 | 1.25 | 0.02 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-nano) |
| gpt-5.6-luna | 0.20 | 1.20 | 0.02 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| gpt-6-luna | 0.10 | 0.50 | 0.01 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| gpt-6.1-sol (shop) | 2.00 | 10.00 | 0.10 | [Model pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |

Behavior evals mock **only photo interpretation**, using labeled synthetic PNGs in `fixtures/labels.json`. Actual upload validation, tool dispatch, mismatch notices, valuations, negotiation, orders and payments execute normally. These visibly labeled placeholders do not measure vision accuracy; use `vision_eval.py` with real images separately. `--dry-run` also scripts the customer/shop and is **pipeline validation only**, never measured LLM quality.

The shared cap covers all customer and shop tool-loop requests. Before every inference request, workers use the provider input-token count plus a small margin (falling back to a conservative UTF-8-byte bound) and reserve the full output cap at that model's uncached rates. Usage reconciles each reservation using actual input/output tokens and **provider-reported cached input**, including reasoning output. Reservations never assume a cache hit. SDK retries are disabled; failed requests without usage retain their full reservation. The SDK timeout is 120 seconds for eval conversations, avoiding the former 45-second harness timeout. When another reservation would exceed the cap, provider requests stop and affected runs are incomplete. Exit codes: `0` tasks passed, `1` failures, `2` budget stopped. Prices are local standard-processing estimates, not a billing guarantee; no key is saved.

Each output directory contains `results.json` (authoritative for that invocation) and `transcripts/<scenario>_<run>.json`. Reports do not aggregate stale transcript files. Use separate directories for coverage and repeat suites. Original evidence from the audit is preserved under `output/baseline`; [audit.md](audit.md) classifies every original transcript. Error records now contain redacted chained tracebacks, including the provider cause normally hidden by HTTP 502. The original two 502 records did not contain a traceback; their cause cannot be recovered from those files.

Use `--resume` with the same output directory, filters and run count to retain completed conversations, including failures, and retry incomplete runs. It carries forward checkpointed spend and any outstanding reservations, so restarting never resets the cap. Repeats run in rounds: every selected scenario is attempted before its second repeat, to preserve coverage under a tight cap. `--prior-spend-usd` carries costs from an earlier attempt in a different directory. Keep those attempts as evidence; a simulator repair does not erase their cost.

Scoring accepts return policy returned via `topic=all`, verifies filtered unavailable searches and in-stock alternatives, and recognizes exact checkout sums from **earlier** catalog, delivery and quote results. Incorrect arithmetic, future results and an invented unit price still fail. Installment amounts require earlier tool results. The 5% negotiation ceiling and payment-endpoint ledger checks remain unchanged. `pass^3` is calculated only for exactly three completed repeats; one run is N/A. Budget-interrupted/skipped runs are excluded from success denominators and reported as incomplete. Failed runs retain snapshots and traces. Temporary databases/media are cleaned up afterward.
