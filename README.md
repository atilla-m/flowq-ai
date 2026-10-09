# FlowQ AI

**An AI sales agent for any business that sells over the phone and in chats: WhatsApp today, and
built so other messaging and social channels can be plugged in. It answers instantly, remembers
the customer across channels, and completes the whole sale** — stock and
price, trade-in with photo verification, negotiation inside hard limits, upsell, delivery, payment
and order tracking — while every price, limit and payment check is enforced in backend code, not by
the model.

Everything specific to one business — catalog, prices, policies, limits and the agent's
instructions — lives in an **industry pack**. This repository ships one pack, a gadget shop, and
the demo runs on it. The same agent and rules engine are meant to serve other businesses by
swapping the pack.

## Who it is for, and the problem

Small and mid-sized businesses that sell through calls and chats rather than a web checkout:
electronics and gadget shops, home appliance and furniture stores, auto parts, building materials,
cosmetics, flowers and gifts, and resellers of used goods that take trade-ins. In markets like
Azerbaijan most of these sales happen on a phone call, on WhatsApp or in social media direct
messages.

They share the same problems. Calls go unanswered after hours. A customer who moves from a call to
a chat has to repeat everything. Prices, discounts and trade-in offers depend on whoever picks up.
FlowQ gives the business one agent that is always available, talks to the customer on the channel
they chose, and cannot be talked into a price the business's own rules do not allow.

## One agent, many businesses

What stays the same for every business is in the core: the voice and chat agent, shared customer
memory, the order and payment flow, callbacks, handoff to a person, and the rule that money
decisions are computed in code. What changes is the pack:

| In the pack | Gadget shop (included) | Another business would supply |
| --- | --- | --- |
| Catalog and stock | Phones, laptops, tablets, accessories | Its own products and variants |
| Pricing rules | Trade-in values and deductions | Its own buy-back, discount or bundle rules |
| Negotiation limits | Trade-in offer may rise at most 5% | Its own ceiling and step |
| Delivery and branches | Baku districts, fees, three branches | Its own zones, fees and locations |
| Policies | Returns, warranty, installments | Its own terms |
| Agent instructions | Voice and WhatsApp prompts for a gadget shop | Prompts in its own tone and language |

### …and many channels

The agent is not tied to WhatsApp. A chat turn is just text and photos in, messages out, and the
voice agent and the chat agent share one tool registry and one customer memory. A channel is a thin
adapter around that: it receives the customer's message, runs the same chat turn, and delivers the
agent's replies, photo requests, order summaries and payment links as that channel's messages.
`backend/whatsapp.py` is that adapter for WhatsApp. Instagram and Facebook Messenger direct
messages, Telegram or a website chat widget would each be another adapter of the same shape, with
no change to the agent or the rules.

Built today: browser voice calls, the WhatsApp-style chat panel, real WhatsApp through the Twilio
sandbox, and a telephone bridge. No other social or messaging channel has an adapter yet.

### How far this goes today

Only the gadget pack exists, and four of the 17 tools are written with
devices in mind. Photo verification and trade-in pricing describe a device (model, storage,
battery, cracks), accessories are matched to a phone model, and product search is tuned for device
specs. Another business would adapt or drop those. Delivery, negotiation limits, orders, payment,
order status, store policy, installments, branches, callbacks, handoff, customer memory and the
tool trace do not depend on what is being sold.

## Try it

| | Link | Notes |
| --- | --- | --- |
| **Mock demo (always on)** | https://flowq-ai.vercel.app | Runs entirely in the browser on scripted data. No backend, no AI, no keys. |
| **Live demo (real AI)** | https://distance-qui-ver-partition.trycloudflare.com | Real voice and chat agent. Works while our laptop is online. |

Both demos run the gadget shop pack. Things to say (voice call) or type (WhatsApp panel):

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
- **Industry pack.** Catalog, pricing rules, delivery fees, negotiation limits, policies and prompts
  live in `industry_packs/<name>/` as JSON and Markdown, selected with `INDUSTRY_PACK`. The core
  loads them as data and imports no business-specific code; `industry_packs/gadgets/` is the one
  pack included.
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
| **Data** | Synthetic demo data only, for a fictional gadget shop: customers, catalog, prices and trade-in values in AZN. No real customer data. |
| **Built with** | OpenAI Codex and Claude Code. |

## Known limitations

- **Payment is a mock.** The pay page marks the order paid in the demo database; nothing is charged.
- **The Twilio phone line is not live.** The telephone bridge is implemented and tested with
  mocked providers, but there is no working public phone number; use the browser voice call.
- **WhatsApp is a simulated panel** in the demo. Real WhatsApp works only through the Twilio
  sandbox, for one registered demo number.
- **Channels.** Voice and WhatsApp are the only channels built. The design allows other messaging
  and social channels, but no Instagram, Messenger or Telegram adapter exists yet.
- **One industry pack so far.** Only the gadget shop pack is built and tested. Serving another kind
  of business needs a new pack, and the four device-oriented tools (photo verification, trade-in
  pricing, accessory matching, product search) would need adapting. No second pack has been tried.
- **Demo data.** Customers, stock, prices and orders are fictional; orders are not fulfilled.
- **The live demo runs on a laptop** behind a temporary tunnel. If it is offline, use the mock demo.
- **No accounts or authentication.** The customer picker stands in for caller identity; this is a
  demo, not a production deployment.
- **Photo checks are model judgments** and can be wrong; the price rules applied to them are fixed.
