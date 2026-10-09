# FlowQ frontend integration

Backend base URL: `http://localhost:8000`. All twelve routes from the shared contract are available. CORS allows origins from `ALLOWED_ORIGINS`, defaulting to `http://localhost:5173`. The agent defaults to English and replies in the customer's language when they switch. Read [README.md](README.md) for a complete tool argument table and curl examples; OpenAPI is at `/docs`.

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
    sku: string; name: string; kind: "phone" | "product" | "accessory"; quantity: number;
    price_azn: number; line_total_azn: number; storage?: number; color?: string;
    category?: "phones" | "laptops" | "tablets" | "watches" | "headphones" | "consoles";
    brand?: string; warranty_months?: number;
    specs?: {storage_gb: number | null; ram_gb: number | null; cpu: string | null; screen: string | null};
  }>;
  tradein: null | {quote_id?: string; offer: number; credit_azn: number; historical?: boolean; [key: string]: unknown};
  delivery: {address: string; district: string; fee_azn: number};
  total: number; total_azn: number; currency: "AZN";
  status: "awaiting_payment" | "paid" | "processing" | "delivered" | "returned";
};
```

At `/pay/{order_id}`, fetch `GET /api/orders/{order_id}` and display its backend total. The mock button calls `POST /api/payments/{order_id}/pay` (no body required), which returns `{status:"paid"}`. That endpoint is the only way payment becomes paid; a chat message or function call cannot do it. Repeated payment clicks are idempotent. The inbox receives confirmation and an `order_update` when payment is first recorded.

Order-tool arguments use **catalog SKUs** and `tradein_quote_id`, never client-side prices/totals. Quote IDs and uploaded media are bound to the customer's phone. Unknown districts require clarification. Purchase accessories must match an exact device model in the same order. The negotiation baseline is the condition-adjusted `final_offer`, and backend quote state wins over model-supplied base/current amounts.

HTTP 503 on chat/session means no OpenAI key; HTTP 502 means a provider request failed. These endpoints return FastAPI `{detail: string}` error bodies. Tool business/validation failures are `{result:{error,message}}` at HTTP 200. Preserve and display a clear error state so a failed provider call does not leave the call/chat UI loading indefinitely.

## Expanded catalog and customer history

The pack now contains 80 SKUs across six categories, 40 accessories and 20 demo customers. Phone cards keep `kind:"phone"`; other catalog products use `kind:"product"`. Catalog cards and order items also carry `category`, `brand`, `specs` and `warranty_months`. Cards include `colors`, listing the color variant represented by that SKU. Existing top-level `storage` and `color` fields remain available. `specs.storage_gb` is null for devices without storage (top-level `storage` is then 0). Other null specs are undisclosed or not applicable; do not display invented values.

Customer history includes seeded processing, unpaid, delivered and returned orders. Read them through the existing history/order tools and `GET /api/orders/{id}`. Seed IDs start with `DEMO-`; delivery data has `demo_history:true`. Seed records never manufacture `paid`: `check_payment_status` returns `not_recorded` if no payment ledger exists. The unpaid `DEMO-11-01` is pending and can use the normal mock payment endpoint. The endpoint returns HTTP 409 for processing/delivered/returned orders; a human handles their historical payment or refund questions.

## New tools and inventory filters

Both Realtime and chat advertise **17 tools** through the shared registry. Existing names are unchanged. Dispatch the three new names through `/api/tools/{tool_name}` using the existing envelope; no new routes are needed.

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_store_policy` | `{topic}` | Topics: all/branches/returns/warranty/installments. `{topic,policy,...}` or a clarification. Branch addresses are synthetic demo locations |
| `check_installment` | `{sku,months}` | Single-SKU estimate for 3/6/12 months: `{eligible,price_azn,monthly_payment_azn,final_payment_azn,total_azn,down_payment_azn,interest_pct,fee_azn,approval_required,...}`. Ineligible results include `reason` and `available_months` |
| `find_branch` | `{district}` | `{district,branches:[{id,name,district,address,hours,serves_districts,...}],timezone,needs_clarification,...}`. Selection uses a configured district assignment, not live distance or opening status |

`search_inventory` now accepts flat arguments `{query?,category?,brand?,min_price?,max_price?,in_stock?,limit?}`. At least a query or filter is required. The limit is 1–20 (default 6); bounds are inclusive AZN prices. Canonical categories are phones/laptops/tablets/watches/headphones/consoles; singular forms are also accepted. The result is `{items,alternatives,out_of_stock,currency,query,filters}`. When every query match is unavailable, `items` preserves unavailable matches and `alternatives` contains up to three available SKUs of the same category, preferring the same brand and closest price. Explicit brand and price filters also constrain alternatives. With `in_stock:true`, unavailable matches are omitted from `items`, while availability and alternatives are still returned. WhatsApp receives up to two matching cards, or alternative cards when the requested item is unavailable.

```json
{"phone":"+994501234567","channel":"voice","args":{"category":"laptops","brand":"Apple","min_price":2000,"max_price":3000}}
```

The existing `get_accessories({phone_model})` also accepts laptop/tablet/watch/console/headphone model names. Its argument name stays unchanged; compatibility and images still match the exact model, including Plus variants.

Inventory queries ignore conversational filler such as “do you have”, “in stock” and “price”. Brand, product-family and category words scope the matches. If no model/variant matches, recognized brand/category scopes can return broader items with a non-null `fallback:{brands,categories,reason}`. A null `fallback` means no broad fallback was used. Never label fallback items as the unavailable requested model; explicit filters still apply. Stock-only searches must use `in_stock:true`.

For `check_installment`, `{"sku":"MBA13-M4-256-SKY","months":6}` estimates a 2499 AZN purchase at 416.50 AZN per month (the final payment is also 416.50). It reads current DB stock; quotes exclude delivery and trade-in and require card/provider approval. It never creates a payment or financing agreement. The first installments round down to cents; the final one settles the remainder. Returns are 14 days under the tool-provided conditions; warranty duration comes from each SKU.

Additional asset routes remain `GET /api/media/{media_id}` and `GET /api/assets/accessories/{sku}.svg`.

## Real telephone calls

Browser voice endpoints, ephemeral keys and tool dispatch stay unchanged. Twilio adds signed `POST /api/twilio/voice`, `WS /api/twilio/media`, and `POST /api/twilio/status`; the frontend does not connect to these routes or execute phone tools. The server binds telephone tools to the caller's customer with `channel:"phone"`. Public `/api/tools` still takes only `voice` or `whatsapp`.

When `DEMO_CALLER_PHONE` matches the actual caller, memory and inbox use Aysel Məmmədova's demo number `+994501234567`. Select Aysel in the customer picker to see requests, upload photos, open payment links and receive handoff/order events during the real call. Keep existing inbox polling and upload behavior. The server forwards new upload IDs to telephone Realtime automatically. Other real callers use their own normalized phone number; the customer list includes them after their first call.

Phone `schedule_callback` dials the actual caller through Twilio after the delay and current call ends; it does not emit an `incoming_callback` browser event. Browser/chat callbacks keep the existing event. Human handoff remains a panel notification; it does not transfer a phone line. No real WhatsApp transport is added.

Phone tools and diagnostic `realtime_turn`/`twilio_callback` records appear in `/api/trace` with `channel:"phone"`; diagnostics are not additional callable tools. Call summaries appear in customer history with conversation channel `phone`. A single telephone call is allowed at a time and each is limited to five minutes; browser calls use their existing flow independently. See [Twilio setup](README.md#real-telephone-calls-with-twilio) for tunnel and environment steps; that example uses backend port 8001, so configure the frontend's API base URL accordingly.
