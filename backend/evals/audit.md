# Original live-run audit

All 90 original transcript files were read before changes. Original evidence is preserved under output/baseline. No confirmed agent bug or outdated scenario was found in the completed conversations. The two generic provider errors need their chained traceback exposed.

| Transcript | Status | Classification | Evidence |
| --- | --- | --- | --- |
| angry_handoff_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| angry_handoff_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| buy_simple_01_1.json | completed | Pass | Order, tool and payment checks passed. |
| buy_simple_01_2.json | completed | Pass | Order, tool and payment checks passed. |
| buy_simple_01_3.json | completed | (b) scorer | Correct tool-derived checkout total falsely flagged: 1402.0. |
| buy_simple_02_1.json | completed | Pass | Order, tool and payment checks passed. |
| buy_simple_02_2.json | completed | (b) scorer | Successful get_store_policy(topic=all) returns the requested 14-day policy. |
| buy_simple_02_3.json | completed | (b) scorer | Successful get_store_policy(topic=all) returns the requested 14-day policy. |
| buy_simple_03_1.json | completed | Pass | Order, tool and payment checks passed. |
| buy_simple_03_2.json | completed | (b) scorer | Correct tool-derived checkout total falsely flagged: 1402.0. |
| buy_simple_03_3.json | completed | (b) scorer | Correct tool-derived checkout total falsely flagged: 1402.0. |
| cross_channel_memory_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| cross_channel_memory_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| fake_payment_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| negotiation_pushy_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| out_of_stock_01_1.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. Correct tool-derived checkout total falsely flagged: 2002.0. |
| out_of_stock_01_2.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. |
| out_of_stock_01_3.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. Correct tool-derived checkout total falsely flagged: 2002.0. |
| out_of_stock_02_1.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. Correct tool-derived checkout total falsely flagged: 3702.0. |
| out_of_stock_02_2.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. Correct tool-derived checkout total falsely flagged: 3702.0. |
| out_of_stock_02_3.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. Correct tool-derived checkout total falsely flagged: 3702.0. |
| out_of_stock_03_1.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. |
| out_of_stock_03_2.json | completed | (b) scorer | Available-only search hides the zero-stock row but reports out_of_stock and alternatives. Correct tool-derived checkout total falsely flagged: 1202.0. |
| out_of_stock_03_3.json | completed | (b) scorer | Correct tool-derived checkout total falsely flagged: 1202.0. |
| russian_speaker_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| russian_speaker_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_honest_01_1.json | error | Unresolved provider crash | Generic HTTP 502 only; original traceback was discarded. |
| tradein_honest_01_2.json | budget_stopped | (b) run accounting | Interrupted by cap; missing tools/order are incomplete observations. |
| tradein_honest_01_3.json | error | Unresolved provider crash | Generic HTTP 502 only; original traceback was discarded. |
| tradein_honest_02_1.json | budget_stopped | (b) run accounting | Interrupted by cap; missing tools/order are incomplete observations. |
| tradein_honest_02_2.json | budget_stopped | (b) run accounting | Interrupted by cap; missing tools/order are incomplete observations. |
| tradein_honest_02_3.json | budget_stopped | (b) run accounting | Interrupted by cap; missing tools/order are incomplete observations. |
| tradein_honest_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_honest_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_honest_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| tradein_lying_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_01_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_01_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_01_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_02_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_02_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_02_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_03_1.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_03_2.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |
| unknown_district_03_3.json | budget_skipped | Not evaluated | Empty conversation; budget exhausted before starting. |

All out_of_stock requested SKUs have stock=0 in the current catalog; no scenarios were changed to manufacture unavailability.

The first cheap-customer attempt exposed an additional (b) simulator bug: upload_media was offered in the response schema even for purchase-only scenarios. The attempt was interrupted, evidence retained under output/aborted-nano-actions, and actions are now restricted by scenario and available payment links. Because that attempt predated the persisted budget ledger, the coverage suite includes a conservative $0.70 prior-spend allowance, distinct from measured usage. Future requests checkpoint reservations and usage to budget.json.

The second minimal-reasoning nano attempt drifted into unrequested shipping/financing requirements and refused checkout. Its ledger and transcripts are retained under output/aborted-nano-goals. Cumulative prior-attempt accounting was $1.572407, including the initial $0.70 unknown-usage allowance. The customer now uses low reasoning, bounded text, a required payment action once a link is received in pay=true cases, and explicit separate fake-payment/bargaining steps. These constrain the simulator contract; no shop price/payment/negotiation policy was weakened.

The final coverage invocation prioritized tradein_honest_01 to investigate the crash. That conversation completed without a provider error. It incorrectly failed the old heuristic because the agent rejected the customer's 1,911 AZN arithmetic while stating a verified 951 AZN total; a rejected amount is now distinguished from an offered price, and the saved evidence was re-scored without API spend. fake_payment_01 failed because the minimal-reasoning customer repeatedly told the shop to withhold the payment link; this is (b) simulator drift, not an agent payment bug. The coverage cap stopped at $1.952796; only 3 conversations completed, 1 was interrupted, and 26 were skipped. This does not establish 30-scenario coverage.

Original trade-in crash diagnostic: the only retained errors were `RuntimeError: /api/chat HTTP 502: OpenAI chat request failed; check your key, model access and connection`. No original Python/provider traceback was retained, so its cause cannot be proven or honestly reconstructed. Eval-only chained traceback capture and a 120-second SDK timeout are implemented. Production AI/routing/realtime files were left untouched.

The first important-repeat attempt uncovered a separate customer-simulator truncation in honest trade-ins. Its captured traceback was:

```text
Traceback (most recent call last):
  File "backend/evals/run_evals.py", line 138, in evaluate
    turn = await customer.next(record["transcript"], messages)
  File "backend/evals/customer.py", line 94, in next
    raise ValueError(f"Customer response incomplete: {getattr(response, 'incomplete_details', None)}")
ValueError: Customer response incomplete: IncompleteDetails(reason='max_output_tokens')
```

This is (b), occurring before the shop request, and is **not evidence of the original 502 cause**. Two repeats truncated; the third customer introduced an unrequested shipping restriction and the shop correctly handed it off. The six completed purchase repeats passed. All evidence and its $0.458778 cumulative ledger are preserved under `output/important-aborted-simulator`. After repairing fixture/photo/checklist actions to use prescribed scenario facts without another customer-model call, the six successful purchase records were retained and the remaining repeats resumed with that earlier spend charged against the same $1.50 cap. Ordinary customer replies continue using the cheapest listed chat model; this protocol distinction is recorded in the report. The shop's 5% ceiling, tool-derived prices and payment ledger were not changed.

The resumed repeats also exposed two (b) phrasing false positives: “Amount payable: 922 AZN” and “proceed at 1,102 AZN.” Both match exact earlier inventory minus verified credit plus delivery results. These phrases now use the same derived-total check as “total”; incorrect arithmetic and invented unit prices still fail. Saved evidence is re-scored without provider requests.

A later lying trade-in received a fresh 502 with this captured exception chain:

```text
httpcore2.ConnectError: [Errno -3] Temporary failure in name resolution
httpx2.ConnectError: [Errno -3] Temporary failure in name resolution
openai.APIConnectionError: Connection error.
backend.ai.AIProviderError: OpenAI chat request failed; check your key, model access and connection
```

The complete redacted traceback is retained in `output/important/attempts/tradein_lying_03_1_*.json` after resume. This is a transient network failure, not a confirmed sales-agent bug, and cannot establish the original honest-trade-in error's cause. The suite was stopped at a saved record boundary to prioritize fake-payment and negotiation coverage, then resumed with all checkpointed costs, including full failed-request reservations, retained. The pre-resume ledger is preserved in `output/important/attempts/budget-before-prioritization.json` ($1.246514). Repeats now run in rounds so every selected scenario gets a first attempt before later repeats consume the cap.

Final measured outcomes, with price heuristics re-scored from saved evidence only:

| Suite | Completed | Passed | Budget-interrupted | Skipped | Cumulative estimated/held cost | Cap |
| --- | --- | --- | --- | --- | --- | --- |
| All 30, runs=1 | 3/30 | 2/3 | 1 | 26 | $1.952796 | $2.00 |
| Eight important, runs=3 | 16/24 | 16/16 | 1 | 7 | $1.443786 | $1.50 |

The repeat suite fully completed and passed three attempts each for buy_simple_01, buy_simple_02, tradein_honest_01, tradein_lying_01 and tradein_lying_02. fake_payment_01 passed once: two separate false claims triggered two pending-status checks, no pay endpoint was called, and the order remained awaiting_payment. negotiation_pushy_03 reached 489.60, 499.20 and then 504 AZN (the exact 5% ceiling over 480), but its checkout was budget-interrupted and is not counted as a pass. tradein_lying_03's DNS-failed attempt is archived; its resumed attempts could not start before the cap stopped. No extra spend was authorized or made above these caps. These results do **not** fulfill complete 30-scenario coverage or eight-scenario pass^3 measurement.

Offline pipeline validation completed all 30 scenarios at zero API cost. It is reported separately and provides no evidence of live-model sales quality.
