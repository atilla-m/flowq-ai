# FlowQ AI backend

FastAPI + SQLite backend for the Azerbaijan gadget-shop demo. The agent speaks English by default and follows the customer's language when they switch. Backend notices, media instructions and order/payment messages are English. Baku district names and AZN stay unchanged. All business prices and domain prompts come from `industry_packs/$INDUSTRY_PACK`. Catalog prices, trade-in values and customer records are fictional demo data in AZN.

## Run

Run these commands from the repository root with Python 3.11:

```bash
python3.11 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# Set OPENAI_API_KEY in backend/.env, then:
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

If `uv` is installed, `uv venv backend/.venv --python 3.11` and `uv pip install --python backend/.venv/bin/python -r backend/requirements.txt` also work. Run from the repo root; relative database and upload paths resolve against that root. The seed is idempotent. A new database starts with 8 customers, 25 phone SKUs and 15 accessories. Orders reserve stock immediately, including unpaid orders, for this short demo.

Once dependencies and `backend/.env` are ready, start with one command: `backend/.venv/bin/python -m backend`. It reads `PORT` (default 8000) and binds to `0.0.0.0`. Startup refreshes static seeded memory from the pack's English summaries while preserving real conversation history and stock.

Health, customer memory, deterministic tools, media upload, inbox, order, trace and mock payment endpoints work without an OpenAI key. Chat, photo verification and voice require a key with access to the configured models. Chat/session return HTTP 503 when the key is absent; tools return an error result. Call-end memory falls back to an explicitly unverified transcript excerpt if summarization is unavailable. No synthetic voice key or fabricated image analysis is generated.

Interactive API docs: <http://localhost:8000/docs>. Frontend integration details: [FRONTEND_CONTRACT.md](FRONTEND_CONTRACT.md).

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Server-side key; never returned to the frontend |
| `CHAT_MODEL` | `gpt-6.1-sol` | Responses agent and call summaries |
| `VISION_MODEL` | `gpt-6.1-sol` | Structured image observations |
| `REALTIME_MODEL` | `gpt-realtime-2.1` | Browser voice session |
| `REALTIME_VOICE` | `marin` | Realtime output voice |
| `TRANSCRIPTION_MODEL` | `gpt-live-transcribe` | Realtime customer transcript events |
| `INDUSTRY_PACK` | `gadgets` | Directory under `industry_packs/` |
| `DATABASE_PATH` | `backend/data/flowq.sqlite3` | SQLite storage |
| `UPLOAD_DIR` | `backend/data/media` | Verified JPEG/PNG/WebP uploads, maximum 10 MB each |
| `BACKEND_PUBLIC_URL` | `http://localhost:8000` | Absolute upload and accessory image URLs |
| `FRONTEND_URL` | `http://localhost:5173` | Payment-link destination |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS origins; set the deployed frontend origin |
| `PORT` | `8000` | Port used by `python -m backend` and the Docker health check |
| `EVAL_INPUT_USD_PER_MILLION` | `2` for default chat model | Optional behavior-eval input rate for model overrides |
| `EVAL_OUTPUT_USD_PER_MILLION` | `10` for default chat model | Optional behavior-eval output rate for model overrides |

Model defaults were checked against official OpenAI documentation on 2026-10-09. GPT-6.1 Sol function calling uses the Responses API; model overrides must support Responses tools/vision as applicable. Realtime uses the GA `POST /v1/realtime/client_secrets` API, not the retired beta `/realtime/sessions` API. Sources: [model selection](https://developers.openai.com/api/docs/models), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [client secrets](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), [Realtime functions](https://developers.openai.com/api/docs/guides/realtime-mcp), [browser WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime).

## API and curl examples

All twelve shared-contract routes are implemented. CORS uses the configured origin allowlist. Set an `order_id` from the order tool result for the order/payment examples below.

```bash
# GET /api/health
curl -s http://localhost:8000/api/health

# GET /api/customers
curl -s http://localhost:8000/api/customers

# GET /api/customers/by-phone/{phone}
curl -s 'http://localhost:8000/api/customers/by-phone/%2B994501234567'

# POST /api/realtime/session — client_secret is a STRING, not {value: ...}
curl -s http://localhost:8000/api/realtime/session \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+994501234567"}'

# POST /api/tools/{tool_name} — common voice and WhatsApp dispatch
curl -s http://localhost:8000/api/tools/search_inventory \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+994501234567","channel":"voice","args":{"query":"iPhone 15 128"}}'

# POST /api/chat — returns customer + tool cards + final agent messages for this turn
curl -s http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+994501234567","text":"Hi, I would like an iPhone 15","media_ids":[]}'

# POST /api/media — multipart fields are exactly file and phone
curl -s http://localhost:8000/api/media \
  -F 'phone=+994501234567' -F 'file=@/absolute/path/screen.jpg'

# GET /api/inbox?phone=...&since=<ISO timestamp> — encode the + sign
curl -sG http://localhost:8000/api/inbox --data-urlencode 'phone=+994501234567'
curl -sG http://localhost:8000/api/inbox \
  --data-urlencode 'phone=+994501234567' --data-urlencode 'since=2026-10-09T00:00:00.000000Z'

# First create a real backend order; take result.id as the order_id below.
curl -s http://localhost:8000/api/tools/create_order \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+994501234567","channel":"voice","args":{"items":[{"sku":"IP15-128-BLK","quantity":1}],"address":"Yasamal, Mətbuat prospekti 10","idempotency_key":"curl-demo-order"}}'

order_id='FQ-REPLACE_WITH_RETURNED_ID'

# GET /api/orders/{order_id}
curl -s "http://localhost:8000/api/orders/$order_id"

# POST /api/payments/{order_id}/pay — the ONLY path that marks a payment paid
curl -s -X POST "http://localhost:8000/api/payments/$order_id/pay"

# GET /api/trace?phone=...
curl -sG http://localhost:8000/api/trace --data-urlencode 'phone=+994501234567'

# POST /api/call/end
curl -s http://localhost:8000/api/call/end \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+994501234567","transcript":"Customer: I want an iPhone 15. FlowQ: Which district for delivery? Customer: Yasamal."}'
```

Additional asset routes are `GET /api/media/{media_id}` for uploaded images and `GET /api/assets/accessories/{sku}.svg` for local placeholders labeled with the exact compatible model.

## Tools

Every request has `{phone, channel:"voice"|"whatsapp", args:{...}}` and returns `{result:{...}}`. Every dispatched tool, including failures, is traced with latency. The same names and argument schemas are provided to Realtime and the WhatsApp Responses agent. Tool-level errors are HTTP 200 with `result.error` and `result.message`; the model must handle them. Request-envelope validation errors use HTTP 422.

| Name | `args` | Result / effect |
| --- | --- | --- |
| `get_customer_history` | `{}` | Name, summaries from both channels, past orders, recent messages/uploads and latest quote |
| `search_inventory` | `{query}` | `{items, currency, query}` with authoritative SKU/price/remaining stock; WhatsApp gets up to two cards |
| `request_media_whatsapp` | `{what?}` | Pushes a `media_request` even during voice; four-view instructions come from pack |
| `analyze_device_media` | `{media_ids?:[], claimed?:{model,storage,battery_health,damage,...}}` | All images sent to vision; structured observations, `analysis_id`, computed mismatches, `need_retake`, reason |
| `calculate_tradein` | `{device_info:{analysis_id?,powers_on,water_damage,repaired_before,face_id_working,icloud_signed_out}}` | `quote_id`, pristine `base_offer`, deductions, condition-adjusted `final_offer`, `current_offer`; verified visual fields override submitted claims |
| `negotiate_offer` | `{quote_id?,customer_ask,base_offer?,current_offer?}` | `{new_offer,max_offer,is_final,quote_id}`; backend quote overrides monetary input arguments |
| `get_accessories` | `{phone_model}` | Only exact compatible model items; WhatsApp gets matching-image cards |
| `calculate_delivery` | `{address}` | District/fee or `needs_clarification:true`; explicit pickup = 0 |
| `create_order` | `{items:[{sku,quantity?}],address,tradein_quote_id?,idempotency_key?}` | Server-recomputed Order + `order_summary` and `order_update`; reserves stock |
| `create_payment_link` | `{order_id}` | Pending URL at `/pay/{order_id}` + `payment_link`; paid orders stay paid |
| `check_payment_status` | `{order_id}` | DB-only pending/paid status |
| `get_order_status` | `{order_id?}` | One order or `{orders:[]}` for this phone |
| `schedule_callback` | `{delay_seconds?:15}` | Due `incoming_callback` inbox event; no background timer needed |
| `handoff_to_human` | `{summary}` | `handoff` event and an agent inbox message |

The phone in the request envelope owns the operation. An optional tool-argument `phone` must match it. A tool cannot read another customer's media, quote, order or payment. Orders ignore no prices silently: unsupported `total`, `price`, `status` and discount arguments fail schema validation. Purchase price comes from the catalog. Trade-in credit comes from a persisted verified quote, and one analysis cannot fund multiple orders. Accessories in an order must match a phone model in that order.

Negotiation's trusted baseline is the **condition-adjusted `final_offer`** from `calculate_tradein`. Its ceiling is that value × 1.05, rounded down to cents. Its step is that value × 0.02. The pristine `base_offer` before deductions is for explanation only. For example, iPhone 13 128 GB with 79% battery and a cracked screen: 480 − 80 − 100 = 300 AZN; negotiation goes 306 → 312 → 315, then holds firm. iCloud sign-out is recorded as a pickup requirement, not falsely inferred from photos.

## Verification and demo scope

```bash
backend/.venv/bin/python -m pytest backend/tests -q
```

Tests cover deterministic trade-in deductions/battery bands, 1,000 random negotiation asks, tampered quote arguments, photo-over-claim pricing, payment status changes only via the payment endpoint, exact accessory compatibility and labels, delivery lookup, stock reservation/idempotency, customer isolation, durable callback timing, inbox cursors, bounded agent loops, OpenAI request payloads, key secrecy, and missing-key behavior. OpenAI calls are mocked, so the suite needs no key or API spend.

This is a hackathon demo: the WhatsApp panel, callback, handoff and payment are browser/SQLite effects. No real WhatsApp transport, telephone callback, courier booking or financial charge is made. Orders progress from `awaiting_payment` to `paid`; fulfillment is reported honestly at that stage. The customer-picker app has no authentication; the CORS allowlist controls browser access, not API authentication.

Data lives under ignored `backend/data/`. To start a fresh demo without deleting history, choose another `DATABASE_PATH` and `UPLOAD_DIR` before restarting. Existing databases preserve stock and history when reseeded. A new industry pack implements the same JSON files and prompts; the core loader does not import industry-specific Python code.

## Evals

No separate server is required. Each run starts an isolated FastAPI app and sends real HTTP route requests against a fresh temporary database; the demo database stays intact.

```bash
# No key needed: 30 scenarios × 3 repeats, scripted provider doubles.
backend/.venv/bin/python backend/evals/run_evals.py --dry-run --concurrency 4 --max-cost-usd 5
# After setting OPENAI_API_KEY in backend/.env:
backend/.venv/bin/python backend/evals/run_evals.py --concurrency 4 --max-cost-usd 5
backend/.venv/bin/python backend/evals/report.py
# Add consented photos and rows to backend/evals/photos/labels.csv first:
backend/.venv/bin/python backend/evals/vision_eval.py --max-cost-usd 5
```

The scenarios use 25 English, 3 Russian and 2 Azerbaijani customer profiles. Behavior evals mock image interpretation from labeled fixtures; the real vision test is separate. Dry-run scores validate the pipeline and are not LLM-quality claims. Transcripts and result JSON are saved under ignored `backend/evals/output/`; [the generated report](evals/results.md) includes task success, pass^3, policy violations, price flags, turns, latency, selected failures and an empty hotline baseline table. See [eval documentation](evals/README.md) for cost accounting, overrides and exit codes, and [real-photo labeling instructions](evals/photos/README.md).

## Docker / Render deployment prep

Build from the repository root. The Dockerfile and its ignore file are both under `backend/`; the image includes only backend runtime code and industry-pack data. Environment files, databases, eval output and the frontend are excluded from the build context.

```bash
docker build -f backend/Dockerfile -t flowq-backend .
# backend/.env can contain local paths; these explicit overrides keep data persistent.
docker run --rm --name flowq-backend -p 8000:8000 \
  --env-file backend/.env \
  -e DATABASE_PATH=/data/flowq.sqlite3 -e UPLOAD_DIR=/data/media \
  -v flowq-data:/data flowq-backend
```

Python is 3.11. Start command: `python -m backend`, which runs Uvicorn on `0.0.0.0:$PORT`. The image's health check is `GET /api/health`. The `/data` volume holds SQLite, its WAL files and media across container recreation. The container user is UID 10001; a manually provisioned bind mount must be writable by that user. A Docker-managed named volume inherits the image directory ownership.

For Render, create a Docker web service with build context at the repository root, Dockerfile path `backend/Dockerfile`, and health-check path `/api/health`. Attach a persistent disk at `/data`; set `DATABASE_PATH=/data/flowq.sqlite3` and `UPLOAD_DIR=/data/media`. Supply the OpenAI key and model variables through the service environment. Set `BACKEND_PUBLIC_URL` to the backend HTTPS URL, and set both `FRONTEND_URL` and `ALLOWED_ORIGINS` to the frontend HTTPS origin (comma-separate extra allowed origins). Keep one service instance for this SQLite demo. The image honors Render's assigned `PORT`. Only files on the mounted disk persist across redeploys. [Render Docker setup](https://render.com/docs/docker), [persistent-disk setup](https://render.com/docs/disks).

The service can start and pass its health check before a key is configured; AI routes return a clear configuration error until the key is added. No deployment is performed by these prep files.
