# FlowQ frontend integration

Backend base URL: `http://localhost:8000`. All twelve routes from the shared contract are available. CORS is open. Read [README.md](README.md) for a complete tool argument table and curl examples; OpenAPI is at `/docs`.

## Voice

`POST /api/realtime/session` with `{phone}` returns exactly:

```ts
type VoiceSession = {
  client_secret: string; // ek_... ephemeral token, valid for creating a session for 600 seconds
  model: string;
  instructions: string; // voice prompt + cross-channel memory
  tools: Array<{type: "function"; name: string; description: string; parameters: object}>;
};
```

Use `client_secret` directly as the Bearer token when posting browser SDP to `https://api.openai.com/v1/realtime/calls` with `Content-Type: application/sdp`. Do not call the retired beta connection endpoint or send an `OpenAI-Beta` header. The voice, transcription, VAD, instructions and tools are attached server-side to the ephemeral token. If sending `session.update`, use the GA shape `{type:"session.update",session:{type:"realtime",instructions,tools}}` and preserve the configured audio options.

For each completed function call (for example `response.function_call_arguments.done`), dispatch once per `call_id`:

```ts
const response = await fetch(`http://localhost:8000/api/tools/${call.name}`, {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({phone, channel: "voice", args: JSON.parse(call.arguments)}),
});
const {result} = await response.json();
dataChannel.send(JSON.stringify({
  type: "conversation.item.create",
  item: {type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result)},
}));
dataChannel.send(JSON.stringify({type: "response.create"}));
```

Forward tool errors as function output too; never leave the model waiting. Keep inbox polling active during voice, since photo requests, mismatch notices, payment links, order summaries and handoff messages can arrive during the call. After an upload the model can use `analyze_device_media` with an empty list to obtain the latest four images, or explicitly pass IDs. To let it react immediately while it is waiting, send a short customer text item on the data channel saying photos were uploaded with their IDs, then `response.create`.

Capture customer transcription events and agent output transcript events, then send `{phone, transcript}` to `/api/call/end` when the call ends. Re-fetch `/api/customers/by-phone/{phone}` to display the updated memory.

## Inbox and WhatsApp

Poll `GET /api/inbox?phone=...&since=...` every 2 seconds using `URLSearchParams` so `+` in the phone is encoded. The response is `{messages: Message[], events: Event[]}`. Omit `since` initially. Persist the greatest **returned** message/event timestamp as the next cursor; leave it unchanged on empty responses. Do not advance to the browser clock or a callback's future `scheduled_at`. Reset the cursor when switching customers. Deduplicate messages and events by `id`, including messages returned by `/api/chat` that are also delivered through polling.

`POST /api/chat` takes `{phone,text,media_ids?:[]}` and returns the new customer text, any tool-generated cards/messages, and final agent text in `messages`. `POST /api/media` takes multipart fields `file` and `phone`, returns `{media_id,url}`, and already inserts a customer image into the inbox. Pass uploaded IDs to the next chat turn; do not render a second permanent copy of the uploaded image. An empty text is accepted when media IDs are attached.

```ts
type Message = {
  id: string; ts: string; from: "agent" | "customer";
  type: "text" | "image" | "product_card" | "payment_link" | "media_request" | "order_summary";
  text?: string; image_url?: string; data?: Record<string, unknown>;
};
type Event = {
  id: string; ts: string;
  type: "incoming_callback" | "order_update" | "handoff";
  data: Record<string, unknown>;
};
```

| Message type | Fields to render |
| --- | --- |
| `text` | `text` |
| `image` | `image_url`; upload ID is `data.media_id` |
| `product_card` | `data.sku`, `data.name`, `data.storage?`, `data.color?`, `data.price_azn`, `data.stock`, `data.kind`; accessory image is `image_url` and compatibility is `data.compatible_models` |
| `payment_link` | `data.url` and `data.order_id` |
| `media_request` | `text` / `data.instructions`, plus upload UI |
| `order_summary` | `data` is the complete Order below |

`incoming_callback` data contains `phone`, `name`, `scheduled_at`, `delay_seconds`; show an incoming-call UI and create a fresh voice session on acceptance. It is emitted once due, persists across backend restarts, and repeats in polling only until the cursor advances. `order_update` data contains `order_id` and `status`; `handoff` contains `phone`, `summary`, `channel`. All are demo browser events.

## Order and payment

```ts
type Order = {
  id: string; order_id: string; phone: string; ts: string;
  items: Array<{
    sku: string; name: string; kind: "phone" | "accessory"; quantity: number;
    price_azn: number; line_total_azn: number; storage?: number; color?: string;
  }>;
  tradein: null | {quote_id: string; offer: number; credit_azn: number; [key: string]: unknown};
  delivery: {address: string; district: string; fee_azn: number};
  total: number; total_azn: number; currency: "AZN";
  status: "awaiting_payment" | "paid";
};
```

At `/pay/{order_id}`, fetch `GET /api/orders/{order_id}` and display its backend total. The mock button calls `POST /api/payments/{order_id}/pay` (no body required), which returns `{status:"paid"}`. That endpoint is the only way payment becomes paid; a chat message or function call cannot do it. Repeated payment clicks are idempotent. The inbox receives confirmation and an `order_update` when payment is first recorded.

Order-tool arguments use **catalog SKUs** and `tradein_quote_id`, never client-side prices/totals. Quote IDs and uploaded media are bound to the customer's phone. Unknown districts require clarification. Purchase accessories must match an exact phone model in the same order. The negotiation baseline is the condition-adjusted `final_offer`, and backend quote state wins over model-supplied base/current amounts.

HTTP 503 on chat/session means no OpenAI key; HTTP 502 means a provider request failed. These endpoints return FastAPI `{detail: string}` error bodies. Tool business/validation failures are `{result:{error,message}}` at HTTP 200. Preserve and display a clear error state so a failed provider call does not leave the call/chat UI loading indefinitely.
