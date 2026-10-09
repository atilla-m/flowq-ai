# FlowQ demo workspace

## Direction and tokens

Operate mode: preserve the two customer phones on the left and live agent console on the right. The polish uses dark titanium devices, quiet separators and Geist typography; the demo itself remains the main content.

- Default dark: background #0A0A0B, surface #111113, hairlines rgba(255,255,255,0.06), primary text #EDEDED, secondary #8A8A8E.
- Mint #22D3A6 is reserved for the call action, live dots and newest timeline action. Red identifies the end-call action. Status colors appear as small dots next to explicit words.
- Geist Sans for interface text; Geist Mono for measurements, amounts, latency, timers, phone numbers and raw tool names/JSON. Self-hosted variable fonts with preloads and swap.
- Workspace max-width 1440 px; columns 58:42 with a 40 px gap. Devices scale to 78dvh with an 800 px cap and stay vertically centered. Muted Call/WhatsApp labels sit below the matching frames.
- Phone identity is FlowQ Store, with AI assistant as the call subtitle and a verified badge in WhatsApp. Customer identity remains in the console.
- Call screen: soft gray gradient, subtle transcript bubbles and inline tool chips, speaking-only waveform and pinned controls. WhatsApp stays dark in both workspace themes: #0B141A background, #202C33 incoming/header, #005C4B outgoing.
- Console: 2×2 customer facts, four mono metrics, newest-first timeline with a thin connector and dots. Newest entry arrives in 150 ms and its dot glows for 2 seconds. Expanded actions retain metadata and exact JSON.

## Scope

All existing functions, API calls, event handlers and voice implementations are retained. Only the theme default/preferences and presentation changed. No new audio capabilities were added: the existing voice interface exposes start/end, so the requested mute/speaker buttons are explicitly disabled. Ringtone, microphone-level formula, speaking states and call drivers are unchanged.

Light mode remains available and an explicit saved light preference is honored. Phones retain their dark app surfaces in light workspace mode. Reduced motion disables decorative and live-state animations.

## Review and corrections

Used the installed frontend-design, Impeccable polish/craft-floor, UI/UX Pro Max contrast guidance and Playwright skills. Reviewed a batched set of six screenshots at 1920×1080 and 1366×768, then confirmed the final set. Tightened console spacing so all four status categories fit in the 1366×768 full trace. Fixed outgoing WhatsApp metadata contrast (5.28:1) while retaining its green surface. Main secondary text measures 5.75:1; incoming chat metadata 6.63:1.

The Impeccable mechanical detector ran once on the changed UI and reported one advisory: typing indicators used bounce motion. Replaced it with an opacity pulse. No other findings were returned.

## Validation

- Production build, lint and git whitespace checks pass.
- Six desktop screenshots: idle, speaking mock call, full trace. Both phone frames, the console, call control and composer fit above the fold with no page overflow. Full trace uses 18 real actions from the existing mock API, all four status categories, product/order/payment cards and a live call.
- Browser checks: markdown/safe links/escaped HTML, theme toggle/persistence, keyboard focus, demo script, stock, trade-in, photo attachment/removal/upload, mismatch, negotiation, accessories, delivery, order creation, unpaid claims, payment/confirmation, expanded JSON, reset/history, human handoff, customer switching and callbacks. No browser exceptions.
- Additional layout checks at 390×844 verify no horizontal overflow; Geist fonts, business identity, device scaling, dark WhatsApp palette and saved light preference verified at both desktop sizes and mobile.
- AST comparison confirms unchanged API calls and functional handlers; no modifications to src/api, src/voice or src/hooks. Real microphone/WebRTC audio was not exercised; browser calls use the existing mock mode.
- Preview on 127.0.0.1:4174; no server started on 5173.

## Screenshot files

All captures are in `/tmp/flowq-polish/output/playwright/`:

| State | 1920×1080 | 1366×768 |
| --- | --- | --- |
| Idle | idle-1920x1080.png | idle-1366x768.png |
| Mock call | mock-call-1920x1080.png | mock-call-1366x768.png |
| Full trace | full-trace-1920x1080.png | full-trace-1366x768.png |

Additional captures: light-1366x768.png, mobile-390x844.png, expanded-json-1920x1080.png and expanded-json-1366x768.png.
