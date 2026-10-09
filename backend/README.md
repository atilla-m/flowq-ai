# FlowQ AI backend

FastAPI + SQLite backend for the Azerbaijan gadget-shop demo. The agent speaks English by default and follows the customer's language when they switch. Backend notices, media instructions and order/payment messages are English. Baku district names and AZN stay unchanged. All business prices and domain prompts come from `industry_packs/$INDUSTRY_PACK`. Catalog prices are static Baku retail estimates; stock, trade-in offers, customer records and branch locations are demo data. See the pack's [data notes and references](../industry_packs/gadgets/README.md).

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

If `uv` is installed, `uv venv backend/.venv --python 3.11` and `uv pip install --python backend/.venv/bin/python -r backend/requirements.txt` also work. Run from the repo root; relative database and upload paths resolve against that root. The seed is idempotent. A new database starts with 20 customers, 80 product SKUs, 40 accessories and 10 historical/open demo orders. Orders reserve stock immediately, including unpaid orders, for this short demo. Seeded processing and unpaid orders reserve once; delivered and returned history does not change current stock.

Once dependencies and `backend/.env` are ready, start with one command: `backend/.venv/bin/python -m backend`. It reads `PORT` (default 8000) and binds to `0.0.0.0`. Startup refreshes static seeded memory from the pack's English summaries while preserving real conversation history and stock.

Health, customer memory, deterministic tools, media upload, inbox, order, trace and mock payment endpoints work without an OpenAI key. Chat, photo verification and voice require a key with access to the configured models. Chat/session return HTTP 503 when the key is absent; tools return an error result. Call-end memory falls back to an explicitly unverified transcript excerpt if summarization is unavailable. No synthetic voice key or fabricated image analysis is generated.

Interactive API docs: <http://localhost:8000/docs>. Frontend integration details: [FRONTEND_CONTRACT.md](FRONTEND_CONTRACT.md).

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Server-side key; never returned to the frontend |
| `CHAT_MODEL` | `gpt-6.1-sol` | Responses agent and call summaries |
| `VISION_MODEL` | `gpt-6.1-sol` | Structured image observations |
| `REALTIME_MODEL` | `gpt-realtime-2.1` | Browser and telephone voice sessions |
| `REALTIME_VOICE` | `marin` | Realtime output voice |
| `TRANSCRIPTION_MODEL` | `gpt-live-transcribe` | Realtime customer transcript events |
| `INDUSTRY_PACK` | `gadgets` | Directory under `industry_packs/` |
| `DATABASE_PATH` | `backend/data/flowq.sqlite3` | SQLite storage |
| `UPLOAD_DIR` | `backend/data/media` | Verified JPEG/PNG/WebP uploads, maximum 10 MB each |
| `BACKEND_PUBLIC_URL` | `http://localhost:8000` | Absolute upload and accessory image URLs |
| `FRONTEND_URL` | `http://localhost:5173` | Payment-link destination |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS origins; set the deployed frontend origin |
| `PORT` | `8000` | Port used by `python -m backend` and the Docker health check |
| `TWILIO_ACCOUNT_SID` | empty | Account owning the voice number; optional telephone integration |
| `TWILIO_AUTH_TOKEN` | empty | Server-side webhook/WebSocket signature validation and outbound calls |
| `TWILIO_PHONE_NUMBER` | empty | Voice-capable Twilio number, in E.164 format, e.g. `+12025550123` |
| `PUBLIC_BASE_URL` | empty | Public HTTPS backend origin, e.g. `https://name.trycloudflare.com`; no path/query |
| `DEMO_CALLER_PHONE` | empty | Your actual E.164 caller number; maps to Aysel's demo customer memory/inbox |
| `TWILIO_WHATSAPP_FROM` | empty | Optional WhatsApp sender, e.g. the sandbox `whatsapp:+14155238886`; turns on real WhatsApp for `DEMO_CALLER_PHONE` |
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
| `search_inventory` | `{query?,category?,brand?,min_price?,max_price?,in_stock?,limit?}` | `{items,alternatives,out_of_stock,currency,query,filters}`; inclusive AZN bounds, canonical category or singular form, limit 1–20 (default 6). Requires a query or filter. Alternatives keep explicit category/brand/budget constraints; WhatsApp gets up to two match/alternative cards |
| `request_media_whatsapp` | `{what?}` | Pushes a `media_request` even during voice; four-view instructions come from pack |
| `analyze_device_media` | `{media_ids?:[], claimed?:{model,storage,battery_health,damage,...}}` | All images sent to vision; structured observations, `analysis_id`, computed mismatches, `need_retake`, reason |
| `calculate_tradein` | `{device_info:{analysis_id?,powers_on,water_damage,repaired_before,face_id_working,icloud_signed_out}}` | `quote_id`, pristine `base_offer`, deductions, condition-adjusted `final_offer`, `current_offer`; verified visual fields override submitted claims |
| `negotiate_offer` | `{quote_id?,customer_ask,base_offer?,current_offer?}` | `{new_offer,max_offer,is_final,quote_id}`; backend quote overrides monetary input arguments |
| `get_accessories` | `{phone_model}` | Exact compatible device model, including laptops/tablets/watches/consoles/headphones; existing argument name retained; WhatsApp gets matching-image cards |
| `calculate_delivery` | `{address}` | District/fee or `needs_clarification:true`; explicit pickup = 0 |
| `create_order` | `{items:[{sku,quantity?}],address,tradein_quote_id?,idempotency_key?}` | Server-recomputed Order + `order_summary` and `order_update`; reserves stock |
| `create_payment_link` | `{order_id}` | Pending URL at `/pay/{order_id}` + `payment_link`; paid orders stay paid |
| `check_payment_status` | `{order_id}` | DB-only pending/paid status, or `not_recorded` for historical orders without payment evidence |
| `get_order_status` | `{order_id?}` | One order or `{orders:[]}` for this phone |
| `schedule_callback` | `{delay_seconds?:15}` | Browser/chat: due `incoming_callback` inbox event. Telephone: durable outbound Twilio job after the delay and after hangup |
| `handoff_to_human` | `{summary}` | `handoff` event and an agent inbox message |
| `get_store_policy` | `{topic}` | Read all/branches/returns/warranty/installments from `policy.json`; unknown topics ask for clarification |
| `check_installment` | `{sku,months}` | 3/6/12-month single-SKU quote from current stock and policy: eligibility, monthly/final amounts, total and approval requirement. No payment state changes |
| `find_branch` | `{district}` | Configured district branch assignment with address/hours/timezone; unknown or ambiguous districts ask for clarification |

The phone in the request envelope owns the operation. An optional tool-argument `phone` must match it. A tool cannot read another customer's media, quote, order or payment. Orders ignore no prices silently: unsupported `total`, `price`, `status` and discount arguments fail schema validation. Purchase price comes from the catalog. Trade-in credit comes from a persisted verified quote, and one analysis cannot fund multiple orders. Accessories in an order must match a device model in that order.

The shared chat/Realtime registry has 17 tools. Inventory categories are phones/laptops/tablets/watches/headphones/consoles. Cards retain `kind:"phone"` for phones and use `kind:"product"` for other catalog devices. Order items include category, brand, specs and SKU warranty. Store returns are 14 days under the pack conditions; installment estimates exclude delivery and trade-in and require provider approval. They round early payments down to cents and settle the remainder in the last payment. Trade-in bases cover every catalog phone/tablet/laptop model+storage; older phone models remain eligible for trade-in even if no longer sold. The photo checklist's Face ID and iCloud fields mean not applicable/no account locks for devices without those features, as documented in the prompts.

Seeded demo order `DEMO-10-01` is processing, `DEMO-11-01` is unpaid and `DEMO-12-01` is returned. Earlier delivered orders and trade-ins appear in customer memory. A seed never sets a payment to paid. Orders without a payment ledger report `not_recorded`; the pay endpoint rejects processing/delivered/returned orders with HTTP 409. A human handles historical payment/refund questions.

Negotiation's trusted baseline is the **condition-adjusted `final_offer`** from `calculate_tradein`. Its ceiling is that value × 1.05, rounded down to cents. Its step is that value × 0.02. The pristine `base_offer` before deductions is for explanation only. For example, iPhone 13 128 GB with 79% battery and a cracked screen: 480 − 80 − 100 = 300 AZN; negotiation goes 306 → 312 → 315, then holds firm. iCloud sign-out is recorded as a pickup requirement, not falsely inferred from photos.

## Verification and demo scope

```bash
backend/.venv/bin/python -m pytest backend/tests -q
```

Tests cover deterministic trade-in deductions/battery bands, 1,000 random negotiation asks, tampered quote arguments, photo-over-claim pricing, payment status changes only via the payment endpoint, exact accessory compatibility and labels, delivery lookup, stock reservation/idempotency, customer isolation, durable callback timing, inbox cursors, bounded agent loops, OpenAI request payloads, key secrecy, and missing-key behavior. OpenAI calls are mocked, so the suite needs no key or API spend.

This is a hackathon demo: the WhatsApp panel, browser callback, human handoff and payment are browser/SQLite effects. With Twilio configured, telephone calls and callbacks use the real phone network, and with `TWILIO_WHATSAPP_FROM` set the one demo caller also gets real WhatsApp messages through the Twilio sandbox. There is no live human telephone transfer, courier booking or financial charge. New orders progress from `awaiting_payment` to `paid`; seeded history also includes processing/delivered/returned states. The customer-picker app has no authentication; the CORS allowlist controls browser access, not API authentication. Twilio entry points require valid signatures.

## Real WhatsApp with the Twilio sandbox

Optional, and only for the one person in `DEMO_CALLER_PHONE`, who is mapped to Aysel's demo customer exactly as for telephone calls. It needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `PUBLIC_BASE_URL`, `DEMO_CALLER_PHONE` and `TWILIO_WHATSAPP_FROM`; it does not need `TWILIO_PHONE_NUMBER`. The browser WhatsApp panel keeps working and shows the same conversation.

1. In Twilio Console open **Messaging → Try it out → Send a WhatsApp message**. From the demo person's WhatsApp, send the shown `join <two-words>` code to `+1 415 523 8886`. Sandbox membership expires after 72 hours; rejoin the same way.
2. In **Sandbox settings**, set **When a message comes in** to `<PUBLIC_BASE_URL>/api/twilio/whatsapp`, method **POST**.
3. Set `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` in `backend/.env` and restart the backend.

**Outbound.** Every agent message written to that customer's inbox after startup is also sent to their WhatsApp as text: replies, the photo request (including when `request_media_whatsapp` runs during a telephone call), product cards, order summaries and payment links. Earlier history is never replayed. `whatsapp_outbox` claims each message before the network call, so one inbox message is sent at most once, including across restarts; a failed send stores only Twilio's numeric error code (for example `twilio_error_63015`, recipient has not joined the sandbox) and is not retried. Payment links use `FRONTEND_URL`, so point that at a public frontend if the link must open on the phone.

**Inbound.** `POST /api/twilio/whatsapp` validates the Twilio signature against `PUBLIC_BASE_URL` and the account SID, handles each `MessageSid` once, and answers with empty TwiML at once. Messages from anyone except `DEMO_CALLER_PHONE` are ignored. Photos (up to 8, JPEG/PNG/WebP, 10 MB) are downloaded from `api.twilio.com` with account auth, verified like browser uploads and stored in the inbox. During a live telephone call a photo-only message is left to the voice agent, whose inbox watcher announces the new media IDs to the call; otherwise the chat agent runs one turn and its reply is delivered by the outbound path.

Product cards go out as text; accessory placeholder images are not attached.

## Real telephone calls with Twilio

The existing browser WebRTC session and HTTP tool envelope remain unchanged. Telephone tools run server-side with `channel:"phone"`; the public `/api/tools` envelope still accepts only `voice` and `whatsapp`. No Twilio secret or permanent OpenAI key is sent to the browser.

1. Create a Twilio account and get a **Voice-capable** phone number. Copy its Account SID, primary Auth Token and E.164 phone number from the console. Use real account credentials for network calls; Twilio test credentials do not place them. Check [trial recipient/account restrictions](https://www.twilio.com/docs/usage/trials) and verify your caller/destination number when required. For Azerbaijan callbacks, check the destination in the console's **Voice → Settings → Geo Permissions**; account/trial restrictions may require an upgrade. See [Twilio dialing permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources).

2. From the repo root, install the updated requirements into the backend environment:

   ```bash
   source backend/.venv/bin/activate
   pip install -r backend/requirements.txt
   # For a uv-managed environment without pip:
   # uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
   ```

3. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and start a temporary HTTPS tunnel in a separate terminal:

   ```bash
   cloudflared tunnel --url http://localhost:8001
   ```

   Copy the printed `https://…trycloudflare.com` origin. A [Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) needs no Cloudflare account. Keep this terminal running; its random hostname changes when restarted. The backend starts in step 5.

4. Edit the existing `backend/.env` (copy `.env.example` only if it does not exist). Set these values:

   ```dotenv
   OPENAI_API_KEY=your-server-side-openai-key
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=your-primary-twilio-auth-token
   TWILIO_PHONE_NUMBER=+12025550123
   PUBLIC_BASE_URL=https://your-name.trycloudflare.com
   BACKEND_PUBLIC_URL=https://your-name.trycloudflare.com
   DEMO_CALLER_PHONE=+99455XXXXXXX
   PORT=8001
   ```

   `PUBLIC_BASE_URL` is the exact external origin used to validate signatures and build the WSS URL. Do not add `/api/twilio/voice` to it. Model/voice variables retain their existing defaults. Keep `FRONTEND_URL` and `ALLOWED_ORIGINS` pointed at the actual frontend. For a browser panel on this laptop, they can remain `http://localhost:5173`; set the frontend's existing API base URL to `http://localhost:8001` for this run.

5. Start a single backend worker, without reload, in another terminal:

   ```bash
   backend/.venv/bin/python -m backend
   # PORT=8001 in .env; alternatively:
   # backend/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8001 --workers 1
   curl -s https://your-name.trycloudflare.com/api/health
   ```

6. In Twilio Console, open the number's configuration. Under **A call comes in**, choose **Webhook**, enter `https://your-name.trycloudflare.com/api/twilio/voice`, and select **HTTP POST**. Configure the call status callback as `https://your-name.trycloudflare.com/api/twilio/status` with **POST** if the console exposes it. Save. See [Twilio incoming-call setup](https://www.twilio.com/docs/voice/tutorials/how-to-respond-to-incoming-phone-calls). Outbound callbacks attach their status webhook automatically.

7. Select **Aysel Məmmədova** (`+994501234567`) in the browser demo, then dial the Twilio number from the phone configured as `DEMO_CALLER_PHONE`. Only that caller maps to Aysel; other callers use their normalized own number. Azerbaijani local forms such as `0501234567` normalize to `+994501234567`; existing international E.164 numbers retain their country code. The target demo customer is marked with `telephony_demo_target:true` in the pack's customer data. A photo request during the phone call appears in Aysel's WhatsApp-style panel. Upload there; the server notifies Realtime of the new media IDs automatically. Orders, payment links and handoff notices appear in the same inbox. They are panel messages, not messages on the real WhatsApp network.

8. Say “Please call me back in 15 seconds.” The agent schedules a durable job, says goodbye, and ends the telephone leg after its goodbye audio is acknowledged. Twilio then dials **your actual number**, not Aysel's synthetic number, after the requested delay and once the original call has ended. Callback requests made in browser voice or chat still generate the original browser event.

Routes:

| Route | Purpose |
| --- | --- |
| `POST /api/twilio/voice` | Signed form webhook → `<Connect><Stream>` TwiML with caller `phone` and a single-use `stream_token`, followed by `<Hangup>` |
| `WS /api/twilio/media` | Signed WSS handshake + account/call/caller/token/codec verification → server-side Realtime bridge |
| `POST /api/twilio/status` | Signed terminal call-status webhook; releases ringing reservations or stops an active bridge |

The bridge uses the same voice prompt, customer memory and 17 function schemas as browser voice. GA audio configuration is `audio.input.format:{type:"audio/pcmu"}` and `audio.output.format:{type:"audio/pcmu"}`. Audio passes through as raw base64 G.711 μ-law, mono, 8 kHz; there is no resampling or audio file header. The server authenticates its OpenAI WebSocket with the permanent key. See [OpenAI WebSockets](https://developers.openai.com/api/docs/guides/realtime-websocket), [GA audio formats](https://developers.openai.com/api/reference/resources/realtime/client-events), and [Twilio media messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages).

On detected caller speech, the server sends Twilio `clear` and OpenAI `conversation.item.truncate` at the estimated played position. Mark acknowledgments and stream timestamps bound that position; marks flushed by `clear` do not count as heard audio. Interrupted/unacknowledged generated text is omitted from memory because partial audio cannot be aligned reliably to text. Tool execution runs separately from audio reception, so slow vision/tools do not block interruption handling. See [OpenAI interruption handling](https://developers.openai.com/api/docs/guides/realtime-conversations).

There is **one concurrent telephone call**. A SQLite lease reserves the slot before streaming or dialing; additional incoming calls hear a short busy message and end. Each telephone leg ends after at most **300 seconds from its voice webhook reservation**. Browser voice does not occupy this slot. Use one service instance and one worker for the callback worker/bridge lifecycle. In Docker/Render, keep the existing persistent SQLite disk, configure `PUBLIC_BASE_URL` to the backend HTTPS origin, and use that origin in Twilio instead of a tunnel.

Every phone tool is logged in `tool_calls` with its latency. `phone_turns` stores each model response's `speech_to_first_audio_ms` (from detected end of customer speech), `response_ms` (generation/tool-call response duration), and status. Greeting/tool-only responses have null speech-to-audio latency when no audio follows. `/api/trace?phone=%2B994501234567` includes `channel:"phone"` tools and diagnostic `realtime_turn` / `twilio_callback` records; these diagnostic names are not model tools. `phone_calls` retains the transcript/end reason. On hangup, cross-channel memory is saved immediately as an unverified transcript fallback, then replaced by a `CHAT_MODEL` summary when available. There is no audio recording.

Pending callback jobs survive restart. An interrupted/failed placement is **not automatically retried**, because its remote outcome can be uncertain; check Twilio call logs before requesting another callback. At most one callback job is scheduled per source telephone call.

Troubleshooting: HTTP 403 means the signature/account failed; check the primary Auth Token and exact public URL. Never disable validation. The webhook and WSS signatures use configured public URLs, including Twilio's documented WSS trailing-slash variant, rather than trusting forwarded headers. HTTP 503 means telephone env configuration is missing/invalid. With no OpenAI key, a signed incoming call receives a polite unavailable message and hangs up. Silence/provider failures end the stream; check Realtime model access and Twilio Debugger. If the tunnel hostname changes, update `.env`, restart the backend, and update the Twilio webhook URLs. Reference: [Twilio signature validation](https://www.twilio.com/docs/usage/security).

Run the integration checks without a server, credentials or paid calls:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_telephony.py -q
backend/.venv/bin/python -m pytest backend/tests -q
```

These tests mock both provider sockets/REST calls. A real network audio/callback check still requires your credentials, destination permissions and public tunnel.

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
