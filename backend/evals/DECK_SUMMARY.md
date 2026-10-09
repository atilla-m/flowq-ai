# FlowQ eval evidence for the deck

Sources: [results.md](results.md), [audit.md](audit.md). Counts are **coverage / repeats**; interrupted/skipped runs are excluded.

| Scenario category | Runs completed | Passed | Key safety checks |
| --- | --- | --- | --- |
| buy_simple | 1 / 6 | 1 / 6 | 0 false-paid flags |
| tradein_honest | 1 / 3 | 1 / 3 | Verified credit; 0 false-paid flags |
| tradein_lying | 0 / 6 | 0 / 6 | Repeats: 100% lies detected/communicated; 0 false-paid flags |
| negotiation_pushy | 0 / 0 | — / — | Partial: 0 violations; 504 AZN held the 5% ceiling over 480 AZN |
| fake_payment | 1 / 1 | 0 / 1 | Repeat: two claims/checks, payment pending; 0 false-paid flags |
| out_of_stock | 0 / 0 | — / — | Not evaluated in these suites |
| unknown_district | 0 / 0 | — / — | Not evaluated |
| russian_speaker | 0 / 0 | — / — | Not evaluated |
| angry_handoff | 0 / 0 | — / — | Not evaluated |
| cross_channel_memory | 0 / 0 | — / — | Not evaluated |

Both suites: **0 negotiation violations; 0 false-paid flags**, including interrupted traces.

## Audit in numbers

**90 original records:** **0 confirmed agent bugs; 14 scoring false failures; 0 outdated scenarios; 2 unresolved provider crashes.** Another **4 interrupted runs** had accounting errors; **66 skipped**, **4 passed**.

Eval fixes: derived/rejected-price grading, `topic=all` returns, available-only alternatives, incomplete-run accounting; later simulator drift/truncation fixed with restricted/prescribed actions. No confirmed agent bug or outdated scenario required repair. Provider diagnostics gained chained tracebacks and a 120-second eval timeout; original crash causes remain unproven.

## Concrete failure examples

- `buy_simple_01` run 3: correct 1,402 AZN total falsely flagged; fixed tool-derived checkout grading.
- `out_of_stock_01`: filtered search hid the zero-stock row; fixed unavailable-signal/alternative verification.
- Honest trade-in rerun: customer hit `max_output_tokens`; prescribed photo/checklist replies removed simulator truncation.

## Limitations

- Incomplete coverage: 3/30 coverage conversations, 16/24 repeats; five scenarios completed all three repeats.
- Simulated customers include prescribed actions; results do not measure real-customer conversion.
- Agent evals mock vision; lie detection does not establish real-image accuracy.

## Measured numbers worth a slide

Median tool latency: **0.96 ms coverage; 26.98 ms repeats** (not end-to-end conversation latency).

Cost per completed conversation: **coverage $1.952796 ÷ 3; repeats $1.443786 ÷ 16**. These allocations include earlier attempts, failed-request reservations and coverage's $0.70 unknown-usage allowance. Clean-conversation unit cost was not reported.
