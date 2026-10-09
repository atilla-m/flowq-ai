# FlowQ AI — frontend

Single-page demo UI for FlowQ AI, the voice + WhatsApp sales agent for gadget shops in Azerbaijan.
Vite + React + TypeScript + Tailwind. No UI library, no router.

- `/` — phone call panel (OpenAI Realtime over WebRTC), WhatsApp-style chat, agent trace drawer, demo script
- `/pay/:orderId` — mock payment page ("Demo payment")

## Run

```bash
cd frontend
npm install
cp .env.example .env.local   # optional, defaults work for local dev
npm run dev                  # http://localhost:5173
```

The backend must be running on `http://localhost:8000` (see `/backend`) with `OPENAI_API_KEY` set
for chat, vision and voice.

Voice needs a microphone and a secure context: `localhost` is fine, any other host needs HTTPS.
Use headphones when recording so the agent doesn't hear itself.

### Without a backend (mock mode)

```bash
VITE_MOCK=1 npm run dev
```

Everything runs on fake data stored in the browser (`localStorage`): chat replies are keyword-driven,
the voice call is a scripted simulation (no microphone, no OpenAI), and the callback, handoff, trace
and payment flows all work. The top bar shows a "Mock data · reset" button.

## Environment variables

| Variable        | Default                 | Meaning                                                  |
| --------------- | ----------------------- | -------------------------------------------------------- |
| `VITE_API_BASE` | `http://localhost:8000` | Base URL of the FlowQ backend                            |
| `VITE_MOCK`     | `0`                     | `1` = built-in fake backend, nothing leaves the browser  |

Vite reads these at build time. No secrets live in the frontend: the OpenAI key stays on the
backend, and the browser only ever gets a short-lived Realtime client secret.

## How voice works

1. "Call FlowQ" asks for the mic, then `POST /api/realtime/session {phone}` →
   `{client_secret, model, instructions, tools}`.
2. The browser opens a WebRTC peer connection, creates the `oai-events` data channel and posts its
   SDP offer to `https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <client_secret>`.
3. Voice, server VAD and input transcription are baked into the client secret by the backend. The
   frontend re-sends only instructions + tools in a `session.update`, then triggers the first
   response so the agent greets the caller.
4. Each `function_call` in a `response.done` is forwarded to
   `POST /api/tools/{name} {phone, channel:"voice", args}`. The `result` goes back as a
   `function_call_output` item, followed by `response.create`.
5. Barge-in is handled by server VAD (`interrupt_response`); the interrupted agent line is marked
   in the transcript.
6. Hanging up posts `POST /api/call/end {phone, transcript}` (transcript is plain text,
   `Customer: … / Agent: …` lines).
7. `schedule_callback` → the call ends after the agent's goodbye; when `/api/inbox` delivers an
   `incoming_callback` event, a full-screen incoming-call screen appears. Accept starts a new session.

**Latency meter** = time from the customer finishing a sentence to the first agent audio
(`input_audio_buffer.speech_stopped` → `output_audio_buffer.started`), plus the server's VAD
silence window when the session reports one, so it reflects what the caller actually experiences.
Turns that need a tool call include the tool round-trip.

During a live call, photos uploaded in the WhatsApp panel are only stored (`POST /api/media`); the
voice agent picks them up through `analyze_device_media`. Outside a call an upload starts a normal
WhatsApp agent turn (`POST /api/chat` with `media_ids`).

## Layout of the code

```
src/api/client.ts     contract client (real) + switch to mock
src/api/mock.ts       in-browser fake backend for VITE_MOCK=1
src/voice/realtime.ts WebRTC + Realtime events + tool forwarding
src/voice/mockCall.ts scripted call for mock mode
src/voice/useCall.ts  call state shared by both drivers
src/hooks/useInbox.ts 2s inbox polling, message de-duplication, events
src/components/       PhonePanel, ChatPanel, MessageBubble, TraceDrawer, DemoScript, Overlays
src/pages/            Home ("/"), PayPage ("/pay/:orderId")
```

## Deploy to Vercel

1. Import the repository in Vercel and set **Root Directory** to `frontend`
   (framework preset: Vite, build `npm run build`, output `dist`).
2. Add the environment variable `VITE_API_BASE=https://<your-backend-host>` (HTTPS is required,
   otherwise the browser blocks the calls as mixed content). For a UI-only preview set `VITE_MOCK=1`.
3. Deploy. `vercel.json` rewrites every path to `index.html` so `/pay/:orderId` works on refresh.
4. On the backend set `FRONTEND_URL` to the Vercel URL, so payment links point at the deployed
   `/pay/...` page, and `BACKEND_PUBLIC_URL` to its public URL, so uploaded photos and accessory
   images load.

CLI alternative: `cd frontend && npx vercel --prod` (set the same env vars with `vercel env add`).
