# Customer phones and agent console

## Design plan

The screen is a live product workspace: two realistic customer phone screens on the left, the agent's live console on the right.

- Palette: near-white `#f8f9fa`, gray-900 `#111827`, secondary gray `#4b5563`, borders `#d1d5db`, primary/live green `#15803d`. WhatsApp uses its own green inside its phone only. Semantic status colors appear only in small pills.
- Type: Inter throughout. Each panel uses 12 px metadata, 14 px body/controls, and 18 px headings or KPI values. Timers and latency use tabular numbers.
- Layout: one-row header, two matching phone frames with status bars/notches, and a full-height console with flat facts, four compact metrics and a scrolling newest-first action timeline.

```text
Logo/name       Customer              Reset demo / Demo script / theme
                         Customer view                 FlowQ Agent
              Voice call          WhatsApp            Customer facts
            ┌───────────┐       ┌───────────┐         2 × 2 facts
            │ status bar│       │ status bar│         4 KPIs
            │ caller    │       │ contact   │         Live actions
            │ transcript│       │ messages  │         title / pill / ms
            │           │       │ cards     │         expand for JSON
            │ Call / End│       │ composer  │         scroll
            └───────────┘       └───────────┘
```

## Review before building

The specified phone frames are the only visual containers on the customer side. The console uses separators rather than nested cards. There is no display typography, promotional copy, full-panel accent fill, idle timer or idle waveform. Phone controls remain fixed while transcripts/chat/timeline scroll internally. The desktop composition scales through CSS; the underlying calls, messages, orders and event handlers retain their behavior.

## Screenshot critique and corrections

Reviewed idle, speaking mock call, and full trace at both 1920×1080 and 1366×768. Reduced the connected-call header so transcript bubbles retain usable space at 768 px height. Arranged identity, device, district and order into exactly four facts. Kept all phone controls and the chat composer pinned inside the frames. Trace rows wrap their titles and reveal channel, timestamp, tool and raw JSON on click. Expanding the console leaves the call control accessible.

The six final screenshots have no page overflow at either desktop size. Both phone frames, the console, call control and message composer are above the fold. The busy trace contains 18 actions, all four semantic status categories, a live call, order and payment cards. Additional checks cover dark mode, 390 px mobile width and expanded JSON.

## Web Interface Guidelines review

Reviewed against the [fresh guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) after the screenshot critique. Top findings resolved:

- `src/index.css:240` — newest-action/order highlight used background animation; replaced with an opacity-only overlay.
- `src/components/PhonePanel.tsx:55` — microphone bars transitioned height; replaced with scaleY while preserving the level formula and speaking state.
- `src/index.css:191` and `src/index.css:258` — long message/action lists lacked render containment; added content-visibility and intrinsic sizing, verified with 80 items each.
- `src/index.css:279` — demo drawer lacked scroll containment; added overscroll-behavior.
- `src/pages/PayPage.tsx:7` — payment inputs suppressed focus outlines; restored visible keyboard focus and added input names/autocomplete metadata.
- `src/components/PhoneFrame.tsx:14` — decorative status icons now explicitly hide from assistive technology.
- `src/components/icons.tsx:195` — white logo strokes disappeared in dark mode; strokes now use the theme surface color.
- `src/components/TraceDrawer.tsx:190` — reset/history metadata could crowd the console toolbar; moved to a wrapping second line.

Verified semantic buttons, control labels, image alt/dimensions, reduced motion, tabular numbers, theme metadata and the single 12/14/18 px Inter type scale. Existing event, navigation and API behavior remains intact to honor the visual-only scope.

## Validation

- Production build and lint pass; git diff whitespace check passes.
- Browser checks pass for markdown (including escaped HTML and safe links), theme/focus, demo-script controls, stock, photo attachment/removal/upload, mismatch, trade-in, negotiation, accessories, delivery, order creation, unpaid claims, payment and paid confirmation.
- Reset/history, trace JSON, customer switching, human handoff and callback accept/start/end pass without browser exceptions.
- AST comparison confirms unchanged API call expressions and functional handlers. No changes in src/api, src/voice or src/hooks; ringtone implementation is unchanged. Real microphone/WebRTC audio was not exercised; call verification uses the existing mock mode.
- Preview ran on 127.0.0.1:4174; no server was started on 5173.

Screenshots:

| State | 1920×1080 | 1366×768 |
| --- | --- | --- |
| Idle | `/tmp/flowq-second-redesign/idle-1920x1080.png` | `/tmp/flowq-second-redesign/idle-1366x768.png` |
| Mock call | `/tmp/flowq-second-redesign/mock-call-1920x1080.png` | `/tmp/flowq-second-redesign/mock-call-1366x768.png` |
| Full trace | `/tmp/flowq-second-redesign/full-trace-1920x1080.png` | `/tmp/flowq-second-redesign/full-trace-1366x768.png` |
