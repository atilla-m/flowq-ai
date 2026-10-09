# Behavior and vision evals

Run from the repository root with the backend environment installed. No separate backend server is required: each run starts the real FastAPI app in-process and sends HTTP requests to `/api/chat`, media, inbox and payment routes using HTTPX's ASGI transport. Each scenario runs three times with an isolated temporary SQLite database, reset stock and a fresh phone. The demo database is never reset or touched.

```bash
backend/.venv/bin/python backend/evals/run_evals.py --dry-run --concurrency 4 --max-cost-usd 5
# After setting OPENAI_API_KEY in backend/.env:
backend/.venv/bin/python backend/evals/run_evals.py --concurrency 4 --max-cost-usd 5
# A smaller initial live sample (3 runs per selected scenario):
backend/.venv/bin/python backend/evals/run_evals.py --limit 3 --concurrency 4 --max-cost-usd 5
backend/.venv/bin/python backend/evals/report.py
backend/.venv/bin/python backend/evals/vision_eval.py --max-cost-usd 5
```

The 30 scenarios cover ten categories with three scenarios each, in **25 English, 3 Russian and 2 Azerbaijani** variants. A run has at most 12 customer turns. In live mode the customer uses `CHAT_MODEL` with its private persona/goal/facts; those facts are never injected into the shop prompt. The shop also uses `CHAT_MODEL` through the existing agent loop. The harness performs explicit upload/pay actions; saying “I paid” never counts as a payment-endpoint call. Earlier voice memory is seeded only for memory scenarios.

Behavior evals mock **only photo interpretation** from labeled synthetic PNGs in `fixtures/labels.json`. Actual upload validation, tool dispatch, mismatch notices, deterministic valuations, negotiation, orders and payments execute normally. Synthetic fixtures are visibly labeled placeholders, not evidence of vision accuracy. `vision_eval.py` measures the real `VISION_MODEL` separately using [photos/README.md](photos/README.md).

`--dry-run` mocks both the simulated customer and shop model as well, exercising the full pipeline without any OpenAI requests. The report is prominently labeled **pipeline validation only**, so dry-run success must not be presented as measured LLM performance.

Output is overwritten for the selected scenario/run filenames under `output/transcripts/<scenario>_<run>.json`; `output/results.json` is authoritative for the current run. Reports never aggregate stale transcripts. Each transcript includes visible conversation, pay-endpoint ledger, tool calls, final DB state, metrics and failure reasons. Temporary databases/media are cleaned up after snapshots are saved. `results.md` is generated automatically; `report.py` regenerates it and selects up to five actual failed transcripts. If none fail, it says so. The hotline baseline table is intentionally empty.

Task success uses checkable scenario criteria. pass^3 means all three repeats passed, calculated only for fully evaluated scenarios. The price checker flags currency amounts/price phrases unsupported by **earlier** tool results, excluding explicit customer-budget references; it is a deterministic heuristic and may miss unusual wording. Tool schema/business mistakes are also counted. Latency uses logged tool measurements; mocked vision latency is not real vision latency.

The shared cost cap covers customer **and** shop OpenAI calls, including all shop tool-loop steps. Before every request, all workers reserve a conservative input estimate plus the full output-token cap. Returned input/output usage (including reasoning output tokens) reconciles that reservation; caching discounts are not assumed. SDK retries are disabled, and a failed request without usage keeps its full reserved estimate. Once the next reservation would exceed the cap, no further provider requests start; pending/skipped runs are marked incomplete. Exit codes: `0` all evaluated tasks passed, `1` failures, `2` budget stopped.

Default GPT-6.1 Sol rates are 2 USD / million input tokens and 10 USD / million output tokens, checked on 2026-10-09 against [official model pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Rates are estimates for standard processing, not a billing guarantee. When overriding the model, provide current rates with `--input-usd-per-million` and `--output-usd-per-million` (or behavior-eval environment variables `EVAL_INPUT_USD_PER_MILLION` and `EVAL_OUTPUT_USD_PER_MILLION`). All monetary accounting is local; no API key is saved in outputs.
