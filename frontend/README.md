# FlowQ AI — frontend

Single-page demo UI for FlowQ AI, the voice + WhatsApp sales agent for gadget shops in Azerbaijan.
The UI and demo are in English; prices are in AZN and Baku district names are kept as they are.
Vite + React + TypeScript + Tailwind. No UI library, no router. Inter is bundled with the app
(no font CDN), so the page looks the same offline.

- `/` — phone call (OpenAI Realtime over WebRTC), WhatsApp-style chat, customer card, agent trace
  timeline with KPI cards, demo script drawer
- `/pay/:orderId` — mock payment page ("Demo payment")

## Run

```bash
cd frontend
npm install
cp .env.example .env.local   # optional, defaults work for local dev
npm run dev                  # http://localhost:5173
```

The backend must be running on `http://localhost:8000` (see `/backend`) with `OPENAI_API_KEY` set
in `backend/.env` for chat, photo verification and voice.

Two things that will otherwise look like "backend unreachable":

- **Port 5173 matters.** The backend only answers browser origins listed in its `ALLOWED_ORIGINS`
  (default `http://localhost:5173`). The dev server is pinned to 5173 for that reason. If you serve
  the frontend from anywhere else, add that origin to the backend's `ALLOWED_ORIGINS`.
- **The microphone needs a secure context**: `http://localhost` works, any other host must be
  HTTPS (Vercel provides it). Opening the dev server through a LAN IP over plain HTTP will not get
  microphone access.

Use headphones when recording so the agent does not hear itself.

### Without a backend (mock mode)

```bash
VITE_MOCK=1 npm run dev
```

Everything runs on fake data stored in the browser (`localStorage`): chat replies are keyword-driven,
the voice call is a scripted simulation (no microphone, no OpenAI), and the callback, handoff, trace
and payment flows all work. The top bar shows a "Mock data · reset" button. The mock mirrors the
backend's tool arguments, results and message shapes, but it is a fixed script, not an AI.

## Environment variables

| Variable        | Default                 | Meaning                                                 |
| --------------- | ----------------------- | ------------------------------------------------------- |
| `VITE_API_BASE` | `http://localhost:8000` | Base URL of the FlowQ backend                           |
| `VITE_MOCK`     | `0`                     | `1` = built-in fake backend, nothing leaves the browser |

These are the only two variables the code reads, and Vite bakes them into the bundle at build
time (change one, rebuild).

**No API key ever belongs in the frontend.** Anything in a `VITE_*` variable is public to every
visitor. The OpenAI key lives only in `backend/.env`; the browser receives a short-lived Realtime
client secret per call and nothing else. `.env`, `.env.local` and every other `.env.*` file are
git-ignored here; only `.env.example` is tracked.

## The screen

- **Header**: customer picker, Reset demo, Demo script and a light/dark toggle (light by default;
  the choice is remembered in this browser).
- **Customer card**: name, phone, last device, last order and the agent's memory text. The API
  returns memory as free text, so "last device" is read from it only when the text says the
  customer has that phone (e.g. "Uses iPhone 13"); otherwise it says "Not known yet". "Last order"
  comes from the order messages and order updates in the inbox, and lights up when one arrives.
- **Voice call** (left): a phone mockup with the call button, live transcript and a waveform that
  animates while the agent speaks and follows the microphone while the customer speaks. The
  latency chip sits in the card header.
- **WhatsApp** (right): the chat, in WhatsApp's own colours.
- **Agent trace** (bottom): four KPI cards and a timeline of what the agent did.

## Recording the demo

- **Demo script**: a slide-over drawer with the scenario step by step, an English line to say for
  each step and what should happen. Tick steps off as you go; ticks survive closing the drawer.
  Esc closes it.
- **Reset demo**: clears this browser's view for the selected customer: chat, call transcript,
  latency, trace, KPIs, banners and script ticks. It ends a live call. It is frontend-only:
  nothing is deleted on the backend, so the agent still remembers earlier calls and existing
  orders. "show history" in the trace header brings the hidden items back.
- **Agent trace**: every tool call, newest first, as one plain-English line each, for example
  "Checked stock: iPhone 15 128 GB — 5 in stock, 1399 AZN". Click a row for the raw arguments and
  result. Each row has a status pill:
  - **OK**: a normal tool call
  - **Policy block** (amber): a backend rule held the line — the final offer at the +5% cap, an
    "I paid" claim the database does not confirm, photos that need a retake
  - **Mismatch** (fuchsia): the photos contradict what the customer said
  - **Error** (red): the tool returned an error
- **Trace size**: the chevron switches between the latest step only and the full timeline; the
  expand button makes it tall; **AA** enlarges the text. On short screens (under about 880 px
  high) it starts on "latest step only" so the call and chat keep their room.
- **KPI cards**: tool calls (with an error count when there are any), last/median tool latency,
  policy blocks and mismatches detected, counted since the last Reset demo (or over all history if
  you never reset).
- **Latency chip** (voice card): time from the customer finishing a sentence to the first agent
  audio, including the server's voice-activity silence window when the session reports one. Turns
  that need a tool call include the tool round-trip.
- Checked layouts: 1920×1080 and 1366×768, full browser window, light and dark. At 1920 wide the
  whole UI scales up slightly so text stays readable on video.

## How voice works

1. "Call FlowQ" asks for the mic, then `POST /api/realtime/session {phone}` →
   `{client_secret, model, instructions, tools}`. `client_secret` is a plain string.
2. The browser opens a WebRTC peer connection, creates the `oai-events` data channel and posts its
   SDP offer to `https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <client_secret>`.
3. Voice, server VAD and input transcription are attached to the client secret by the backend. The
   frontend re-sends only `{type, instructions, tools}` in a `session.update`, then triggers the
   first response so the agent greets the caller.
4. Each `function_call` in a `response.done` is forwarded once per `call_id` to
   `POST /api/tools/{name} {phone, channel:"voice", args}`. The `result` (or the error) goes back
   as a `function_call_output` item, followed by `response.create`.
5. Barge-in is handled by server VAD; the interrupted agent line is marked in the transcript.
6. Hanging up posts `POST /api/call/end {phone, transcript}` (plain text, `Customer: … / Agent: …`
   lines) and then re-reads the customer's memory.
7. `schedule_callback` → the call ends after the agent's goodbye; when `/api/inbox` delivers an
   `incoming_callback` event, a full-screen incoming-call screen appears. Accept starts a new session.

During a live call, photos uploaded in the WhatsApp panel are stored with `POST /api/media` and the
voice agent is told their IDs over the data channel. Outside a call an upload starts a normal
WhatsApp agent turn (`POST /api/chat` with `media_ids`). Limits enforced in the UI to match the
backend: JPEG/PNG/WebP only, at most 8 photos per message.

The frontend never decides that an order is paid. The pay page calls
`POST /api/payments/{id}/pay`, then re-reads `GET /api/orders/{id}` and shows what the backend says.

## Layout of the code

```
src/api/client.ts     contract client (real) + switch to mock
src/api/mock.ts       in-browser fake backend for VITE_MOCK=1
src/voice/realtime.ts WebRTC + Realtime events + tool forwarding
src/voice/mockCall.ts scripted call for mock mode
src/voice/useCall.ts  call state shared by both drivers
src/hooks/useInbox.ts 2s inbox polling, de-duplication by id, events, last order
src/lib/traceView.ts  tool call -> plain-English title and status
src/lib/demoReset.ts  per-customer "Reset demo" cut-off (browser only)
src/lib/theme.ts      light/dark toggle
src/index.css         design tokens (colours, shadows, motion) for both themes
src/components/       PhonePanel, ChatPanel, MessageBubble, CustomerCard, TraceDrawer,
                      DemoScript, Overlays
src/pages/            Home ("/"), PayPage ("/pay/:orderId")
```

## Deploy to Vercel

1. Deploy the backend first (see `backend/README.md`) so you have its public **https://** URL.
2. Import the repository in Vercel and set **Root Directory** to `frontend`
   (framework preset: Vite, build command `npm run build`, output directory `dist`).
3. Add the environment variable **`VITE_API_BASE=https://<your-backend-host>`**, with no trailing
   slash and no `/api`. It must be HTTPS: a page served over HTTPS cannot call an `http://` API
   (the browser blocks it as mixed content). Do not add any other secret. For a UI-only preview,
   set `VITE_MOCK=1` instead.
4. Deploy. `vercel.json` rewrites every path to `index.html`, so `/pay/:orderId` works when the
   link is opened directly or refreshed.
5. On the **backend**, set these to match and restart it:
   - `ALLOWED_ORIGINS=https://<your-app>.vercel.app` — otherwise every API call is blocked by CORS
   - `FRONTEND_URL=https://<your-app>.vercel.app` — payment links point at `/pay/...` on this site
   - `BACKEND_PUBLIC_URL=https://<your-backend-host>` — uploaded photos and accessory images load
6. Open the site, pick a customer and place a call. The browser will ask for microphone access;
   it only does so on HTTPS (which Vercel provides) or on `localhost`.

Notes:

- `VITE_API_BASE` is read at build time. After changing it in Vercel, redeploy.
- Vercel preview deployments get their own URLs. Each one needs to be in the backend's
  `ALLOWED_ORIGINS` (comma-separated), or test previews with `VITE_MOCK=1`.
- CLI alternative: `cd frontend && npx vercel --prod`, with the variable added through
  `vercel env add VITE_API_BASE production`.
