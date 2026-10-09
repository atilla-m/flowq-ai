# FlowQ AI

**An AI sales agent for gadget shops that answers the phone and WhatsApp instantly, remembers the
customer across both, and completes the whole sale** — stock and price, trade-in with photo
verification, negotiation inside hard limits, accessory upsell, delivery, payment and order
tracking — while every price, limit and payment check is enforced in backend code, not by the model.

## Who it is for, and the problem

Small gadget shops in Azerbaijan sell mostly over phone calls and WhatsApp. Calls go unanswered
after hours, the same customer has to repeat everything when they switch from a call to a chat, and
trade-in prices and discounts depend on whoever picks up. FlowQ gives the shop one agent that is
always available, speaks to the customer on the channel they chose, and cannot be talked into a
price the shop's rules do not allow.

## Try it

| | Link | Notes |
| --- | --- | --- |
| **Mock demo (always on)** | _being deployed — link will be added here_ | Runs entirely in the browser on scripted data. No backend, no AI, no keys. |
| **Live demo (real AI)** | https://distance-qui-ver-partition.trycloudflare.com | Real voice and chat agent. Works while our laptop is online. |

Things to say (voice call) or type (WhatsApp panel):

1. "Hi, do you have the iPhone 15?"
2. "I want to trade in my iPhone 13. It is in perfect condition." — then upload a photo of a phone
   when asked; the agent prices on what the photo shows, not on the claim.
3. "Can you do 50 AZN more?" — repeat it: the offer rises in small steps and stops at +5%.

Also worth trying: "I already paid" before paying (the agent checks and does not accept it), and
"I want to speak to a manager" (handoff with a summary). The agent console at the bottom shows
every tool call the agent makes, so you can see what it actually did.

In the live demo, voice needs microphone permission and is limited to 3 voice sessions per visitor
per hour. Payment is a demo page: no card is charged.

## How it works

```
 Customer                         FlowQ backend (FastAPI + SQLite)                 OpenAI
 ────────                         ────────────────────────────────                 ──────
 Browser voice call ── WebRTC ───────────────────────────────────────────────────► Realtime voice model
        │                           ▲ every tool call                                (speech in, speech out)
        │  function call            │
        └──────────────────────────►│  17 tools, one registry for voice and chat:
 WhatsApp-style chat ── HTTPS ─────►│    get_customer_history, search_inventory, request_media_whatsapp      ◄── chat + vision model
        ▲                           │    analyze_device_media, calculate_tradein, negotiate_offer
        │  cards, photo requests,   │    get_accessories, calculate_delivery, create_order
        │  payment link, order      │    create_payment_link, check_payment_status, get_order_status
        └───────────────────────────│    schedule_callback, handoff_to_human, get_store_policy
                                    │    check_installment, find_branch
                                    │
                                    ├─ Rules in code: trade-in price is deterministic; negotiation
                                    │  never exceeds +5%; "paid" only after the payment endpoint;
                                    │  photos override the customer's claims
                                    ├─ Memory per customer, shared by call and chat
                                    └─ Trace of every tool call (shown in the agent console)
```

- **One customer, two channels.** A photo request made during a voice call arrives in the chat
  while the call continues; the next call or chat starts from what was already said.
- **Industry pack.** Catalog, trade-in rules, delivery fees, negotiation limits and prompts live in
  `industry_packs/gadgets/` as JSON and Markdown; the core code is not gadget-specific.
- **Real channels (optional).** With Twilio configured, the one registered demo number also gets
  real WhatsApp messages through the Twilio sandbox, and a telephone bridge exists for real calls.

## Run it locally

Requirements: Python 3.11, Node 20+.

```bash
# Backend (http://localhost:8000)
python3.11 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env        # then set OPENAI_API_KEY in backend/.env
backend/.venv/bin/python -m backend

# Frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

No key? `cd frontend && VITE_MOCK=1 npm run dev` runs the whole UI on scripted data.

Environment variables are documented in [`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example). The OpenAI key stays on the backend; the browser
only ever receives a short-lived voice session secret. More detail:
[backend README](backend/README.md), [frontend README](frontend/README.md).

## Testing and evaluation

```bash
# Unit and API tests. OpenAI and Twilio are mocked; no key or spend needed.
backend/.venv/bin/python -m pytest backend/tests -q

# Behaviour evals: simulated customers against the real HTTP API on a fresh database.
backend/.venv/bin/python backend/evals/run_evals.py --dry-run --concurrency 4 --max-cost-usd 5   # no key
backend/.venv/bin/python backend/evals/run_evals.py --concurrency 4 --max-cost-usd 5             # real models
backend/.venv/bin/python backend/evals/report.py
```

- Results: [`backend/evals/results.md`](backend/evals/results.md)
- Summary of the evidence and its limits: [`backend/evals/DECK_SUMMARY.md`](backend/evals/DECK_SUMMARY.md)
- How the evals work: [`backend/evals/README.md`](backend/evals/README.md)

In the completed eval runs there were 0 negotiation-limit violations and 0 cases of an order
treated as paid without payment. Coverage is incomplete (see the summary), simulated customers are
not real customers, and the agent evals mock image analysis.

## Models, data and components

| | |
| --- | --- |
| **Models (OpenAI)** | `gpt-realtime-2.1` (voice), `gpt-6.1-sol` (chat agent, photo analysis, call summaries), `gpt-live-transcribe` (live transcript of the customer's speech), `gpt-5-nano` (simulated customers in evals) |
| **Backend** | Python, FastAPI, SQLite |
| **Frontend** | React, Vite, TypeScript, Tailwind CSS |
| **Channels and hosting** | OpenAI Realtime over WebRTC, Twilio WhatsApp Sandbox, Cloudflare Tunnel (live demo), Vercel (mock demo) |
| **Data** | Synthetic demo data only: fictional customers, catalog, prices and trade-in values in AZN. No real customer data. |
| **Built with** | OpenAI Codex and Claude Code. |

## Known limitations

- **Payment is a mock.** The pay page marks the order paid in the demo database; nothing is charged.
- **The Twilio phone line is not live.** The telephone bridge is implemented and tested with
  mocked providers, but there is no working public phone number; use the browser voice call.
- **WhatsApp is a simulated panel** in the demo. Real WhatsApp works only through the Twilio
  sandbox, for one registered demo number.
- **Demo data.** Customers, stock, prices and orders are fictional; orders are not fulfilled.
- **The live demo runs on a laptop** behind a temporary tunnel. If it is offline, use the mock demo.
- **No accounts or authentication.** The customer picker stands in for caller identity; this is a
  demo, not a production deployment.
- **Photo checks are model judgments** and can be wrong; the price rules applied to them are fixed.
