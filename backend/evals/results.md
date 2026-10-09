# FlowQ eval results

DRY RUN — scripted providers; pipeline validation only

Created: 2026-10-09T11:50:55.668561Z

Dry-run success is not evidence of LLM sales quality. Live behavior scores measure the chat agent; real-image accuracy is measured separately by vision_eval.py.

## Summary

| Metric | Result |
| --- | --- |
| Runs evaluated / planned | 90 / 90 |
| Task success | 100.0% |
| pass^3 (all three runs pass) | 100.0% (30 fully evaluated scenarios) |
| Negotiation violations | 0 |
| False paid (DB paid without endpoint) | 0 |
| Lie detected and communicated | 100.0% |
| Correct handoff | 100.0% |
| Wrong tool / invented price flags | 0 |
| Median customer turns | 4.00 |
| Median tool latency (ms) | 22.49 |
| p90 tool latency (ms) | 44.75 |
| Estimated API cost (USD) | 0.000000 |
| Cost cap / stopped | 5.00 / False |

## Scenarios

| Scenario | Language | Completed | Task success | pass^3 |
| --- | --- | --- | --- | --- |
| angry_handoff_01 | en | 3/3 | 100.0% | yes |
| angry_handoff_02 | en | 3/3 | 100.0% | yes |
| angry_handoff_03 | en | 3/3 | 100.0% | yes |
| buy_simple_01 | en | 3/3 | 100.0% | yes |
| buy_simple_02 | en | 3/3 | 100.0% | yes |
| buy_simple_03 | az | 3/3 | 100.0% | yes |
| cross_channel_memory_01 | en | 3/3 | 100.0% | yes |
| cross_channel_memory_02 | en | 3/3 | 100.0% | yes |
| cross_channel_memory_03 | en | 3/3 | 100.0% | yes |
| fake_payment_01 | en | 3/3 | 100.0% | yes |
| fake_payment_02 | en | 3/3 | 100.0% | yes |
| fake_payment_03 | en | 3/3 | 100.0% | yes |
| negotiation_pushy_01 | en | 3/3 | 100.0% | yes |
| negotiation_pushy_02 | en | 3/3 | 100.0% | yes |
| negotiation_pushy_03 | en | 3/3 | 100.0% | yes |
| out_of_stock_01 | en | 3/3 | 100.0% | yes |
| out_of_stock_02 | en | 3/3 | 100.0% | yes |
| out_of_stock_03 | en | 3/3 | 100.0% | yes |
| russian_speaker_01 | ru | 3/3 | 100.0% | yes |
| russian_speaker_02 | ru | 3/3 | 100.0% | yes |
| russian_speaker_03 | ru | 3/3 | 100.0% | yes |
| tradein_honest_01 | en | 3/3 | 100.0% | yes |
| tradein_honest_02 | en | 3/3 | 100.0% | yes |
| tradein_honest_03 | az | 3/3 | 100.0% | yes |
| tradein_lying_01 | en | 3/3 | 100.0% | yes |
| tradein_lying_02 | en | 3/3 | 100.0% | yes |
| tradein_lying_03 | en | 3/3 | 100.0% | yes |
| unknown_district_01 | en | 3/3 | 100.0% | yes |
| unknown_district_02 | en | 3/3 | 100.0% | yes |
| unknown_district_03 | en | 3/3 | 100.0% | yes |

## Baseline comparison

Fill this table with measured shop-hotline results before using it in a pitch.

| Shop hotline / service | Minutes to reach a human | Menu steps | Trade-in quote possible by phone (yes/no) |
| --- | --- | --- | --- |
| Shop hotline 1 | | | |
| Shop hotline 2 | | | |
| FlowQ | | | |

## Failures

No failed transcripts in this run. No failure examples were fabricated.

## Measurement notes

Task success uses persisted orders, quotes, events and tool traces plus visible replies. pass^3 is the fraction of fully evaluated scenarios whose three runs all pass; budget-skipped scenarios are incomplete, not successes. Price flags use currency/price expressions and only earlier tool-returned amounts; manual review is needed for unrecognized phrasing. Fixed backend notices also count as customer-visible mismatch communication. Tool latency includes local dispatch and provider latency where applicable; synthetic vision contributes no real vision latency.
