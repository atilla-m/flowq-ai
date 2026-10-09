# FlowQ shop switchboard

Direction: a cobalt-blue shop switchboard where the live call is the hero and WhatsApp is its familiar companion.

## Design plan

- Palette: switchboard cobalt `#1252ee`, midnight blue `#102743`, porcelain blue `#e9eff7`, brushed silver `#cdd9e8`, call-control yellow `#ffe48e`, WhatsApp green `#008069`.
- Type: locally hosted Barlow for the interface and Barlow Condensed for the store identity and call clock. The condensed display recalls signage on a gadget shop; body text remains open and readable.
- Layout: left-aligned controls and facts, a wide call surface containing caller identity and transcript, a narrower WhatsApp panel, and a low-profile trace drawer beneath both.

```text
FlowQ AI                           Customer / demo controls
Customer       Last device       Interest       District       Last order
┌───────────────────────────────────────┐ ┌────────────────────┐
│ FlowQ Store    Live transcript         │ │ WhatsApp           │
│ Call state     Conversation            │ │ Familiar bubbles   │
│ Clock          Conversation            │ │ Product / payment  │
│ Waveform       Conversation            │ │                    │
│ Call control   Response latency        │ │ Message composer   │
└───────────────────────────────────────┘ └────────────────────┘
Agent trace / compact metrics / readable expandable actions
```

## Review before implementation

An initial phone-in-a-card approach would repeat the current empty stage and give call and chat equal visual weight. Replace the decorative phone frame with a full-width call surface. Spend the bold color and display typography on the call; keep memory and trace as structured, quiet information. Use yellow solely for the primary call control. Keep WhatsApp's established green, beige and bubble shapes.

API clients, inbox polling, call hooks, realtime audio, mock scenarios and action handlers retain their existing behavior. Memory extraction and markdown rendering are presentation helpers only.

## Guidelines review

Reviewed the changed UI against the freshly fetched [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

Top findings resolved:

```text
src/components/ChatPanel.tsx:201 - composer label, name and autocomplete added; focus suppression removed
src/components/ChatPanel.tsx:156 - photo preview dimensions and descriptive alt added
src/components/ChatPanel.tsx:183 - hidden photo chooser labeled
src/components/ChatPanel.tsx:144 - sending errors announced and allowed to wrap
src/components/MessageBubble.tsx:36 - product image dimensions, description and lazy loading added
src/components/MessageBubble.tsx:179 - customer photo dimensions and lazy loading added
src/components/PhonePanel.tsx:78 - transcript scrolling respects reduced motion
src/pages/Home.tsx:180 - keyboard skip link added
src/index.css:333 - scroll containment added to transcript, messages and drawers
src/lib/theme.ts:18 - browser theme color follows the active palette
```

Also verified visible focus, semantic controls, live updates, contrast of the main controls, reduced motion, safe areas and long-content wrapping. Expanded trace opens over the transcript/chat side, leaving desktop call controls available. Long trace and message lists use CSS content visibility.

Existing send/payment handlers, route navigation, disabled-button conditions and callback audio are retained under the visual-only requirement.

## Validation

- Production TypeScript/Vite build and Oxlint pass.
- Playwright screenshots and layout checks pass at 1920×1080, 1366×768, 1024×768 and 390×844: no horizontal overflow; both requested desktop sizes fit the viewport; call controls remain visible. Both light and dark themes reviewed.
- Mock demo flow passes: stock lookup, photo request/upload/removal, photo mismatch, negotiation, accessories, delivery, order creation, unverified payment claim, payment popup, paid confirmation, customer switching, reset/history restoration, human handoff and callback acceptance followed by call start/end.
- Markdown checks pass for bold, italic, unordered/ordered lists, inline code, safe links and escaped HTML.
- Memory checks cover the real seed summaries, laptops and phones, saved orders, unknown facts, ownership versus interest/language, and precedence of newer summaries. Extraction is deliberately conservative because the API supplies prose.
- AST comparisons confirm every API call expression in changed components is unchanged. `src/api`, `src/hooks` and `src/voice` have no modifications. Real microphone/WebRTC behavior was not exercised; the integration checks used the existing mock implementation.
- Preview used port 4174; no server was started on 5173.
