# FlowQ eval results

Separate suites; single-run coverage and repeated safety checks are not pooled.

## all

LIVE — real shop model; customer model with prescribed protocol actions; fixture vision mocked

Created: 2026-10-09T13:06:27.068095Z

Dry-run success is not evidence of LLM sales quality. Live behavior scores measure the chat agent; real-image accuracy is measured separately by vision_eval.py.

INCOMPLETE: only 3 of 30 conversations completed before the $2 cap. Cost includes earlier simulator attempts and a conservative $0.70 unknown-usage allowance. The retained fake-payment failure predates the final simulator repair and is classified as simulator drift in audit.md.

### Summary

| Metric | Result |
| --- | --- |
| Runs evaluated / planned | 3 / 30 |
| Completed / errors / turn limit | 3 / 0 / 0 |
| Budget interrupted / skipped | 1 / 26 |
| Task success | 66.7% |
| pass^3 (all three runs pass) | N/A (0 fully evaluated scenarios) |
| Shop / customer model | gpt-6.1-sol / gpt-5-nano |
| Negotiation violations | 0 |
| False paid (DB paid without endpoint) | 0 |
| Lie detected and communicated | N/A |
| Correct handoff | N/A |
| Wrong tool / invented price flags | 0 |
| Median customer turns | 4.00 |
| Median tool latency (ms) | 0.96 |
| p90 tool latency (ms) | 41.28 |
| Estimated API cost (USD) | 1.952796 |
| Prior attempts included in cost (USD) | 1.572407 |
| Cost cap / stopped | 2.00 / True |

### Scenarios

| Scenario | Language | Evaluated | Task success | pass^3 |
| --- | --- | --- | --- | --- |
| angry_handoff_01 | en | 0/1 | N/A | incomplete |
| angry_handoff_02 | en | 0/1 | N/A | incomplete |
| angry_handoff_03 | en | 0/1 | N/A | incomplete |
| buy_simple_01 | en | 1/1 | 100.0% | N/A (single run) |
| buy_simple_02 | en | 0/1 | N/A | incomplete |
| buy_simple_03 | az | 0/1 | N/A | incomplete |
| cross_channel_memory_01 | en | 0/1 | N/A | incomplete |
| cross_channel_memory_02 | en | 0/1 | N/A | incomplete |
| cross_channel_memory_03 | en | 0/1 | N/A | incomplete |
| fake_payment_01 | en | 1/1 | 0.0% | N/A (single run) |
| fake_payment_02 | en | 0/1 | N/A | incomplete |
| fake_payment_03 | en | 0/1 | N/A | incomplete |
| negotiation_pushy_01 | en | 0/1 | N/A | incomplete |
| negotiation_pushy_02 | en | 0/1 | N/A | incomplete |
| negotiation_pushy_03 | en | 0/1 | N/A | incomplete |
| out_of_stock_01 | en | 0/1 | N/A | incomplete |
| out_of_stock_02 | en | 0/1 | N/A | incomplete |
| out_of_stock_03 | en | 0/1 | N/A | incomplete |
| russian_speaker_01 | ru | 0/1 | N/A | incomplete |
| russian_speaker_02 | ru | 0/1 | N/A | incomplete |
| russian_speaker_03 | ru | 0/1 | N/A | incomplete |
| tradein_honest_01 | en | 1/1 | 100.0% | N/A (single run) |
| tradein_honest_02 | en | 0/1 | N/A | incomplete |
| tradein_honest_03 | az | 0/1 | N/A | incomplete |
| tradein_lying_01 | en | 0/1 | N/A | incomplete |
| tradein_lying_02 | en | 0/1 | N/A | incomplete |
| tradein_lying_03 | en | 0/1 | N/A | incomplete |
| unknown_district_01 | en | 0/1 | N/A | incomplete |
| unknown_district_02 | en | 0/1 | N/A | incomplete |
| unknown_district_03 | en | 0/1 | N/A | incomplete |

### Baseline comparison

Fill this table with measured shop-hotline results before using it in a pitch.

| Shop hotline / service | Minutes to reach a human | Menu steps | Trade-in quote possible by phone (yes/no) |
| --- | --- | --- | --- |
| Shop hotline 1 | | | |
| Shop hotline 2 | | | |
| FlowQ | | | |

### Failures

- [buy_simple_02 run 1](output/all/transcripts/buy_simple_02_1.json): RuntimeError: /api/chat HTTP 502: Estimated cost cap reached; no further OpenAI requests will be made
- [fake_payment_01 run 1](output/all/transcripts/fake_payment_01_1.json): Required sales tools were not all called

### Measurement notes

Task success uses persisted orders, quotes, events and tool traces plus visible replies. pass^3 is measured only for scenarios with exactly three completed repeats; a single run is N/A. Budget-interrupted/skipped runs are incomplete, excluded from task-success denominators. Price flags check earlier tool amounts and correctly derived checkout totals; manual review is needed for unrecognized phrasing. Fixed backend notices also count as customer-visible mismatch communication. Tool latency includes local dispatch and provider latency where applicable; synthetic vision contributes no real vision latency. Cost uses per-model rates and provider-reported cached input; reservations never assume a cache hit.

## important

LIVE — real shop model; customer model with prescribed protocol actions; fixture vision mocked

Created: 2026-10-09T13:55:32.477811Z

Dry-run success is not evidence of LLM sales quality. Live behavior scores measure the chat agent; real-image accuracy is measured separately by vision_eval.py.

INCOMPLETE: only 16 of 24 conversations completed before the $1.50 cap. Earlier simulator attempts and failed-request reservations remain included. The negotiation trace reached and held the 5% ceiling, but checkout was budget-interrupted. A transient DNS/provider error is retained in attempts; this suite does not establish all eight scenarios passing three times.

### Summary

| Metric | Result |
| --- | --- |
| Runs evaluated / planned | 16 / 24 |
| Completed / errors / turn limit | 16 / 0 / 0 |
| Budget interrupted / skipped | 1 / 7 |
| Task success | 100.0% |
| pass^3 (all three runs pass) | 100.0% (5 fully evaluated scenarios) |
| Shop / customer model | gpt-6.1-sol / gpt-5-nano |
| Negotiation violations | 0 |
| False paid (DB paid without endpoint) | 0 |
| Lie detected and communicated | 100.0% |
| Correct handoff | N/A |
| Wrong tool / invented price flags | 0 |
| Median customer turns | 4.00 |
| Median tool latency (ms) | 26.98 |
| p90 tool latency (ms) | 99.43 |
| Estimated API cost (USD) | 1.443786 |
| Prior attempts included in cost (USD) | 1.246514 |
| Cost cap / stopped | 1.50 / True |

### Scenarios

| Scenario | Language | Evaluated | Task success | pass^3 |
| --- | --- | --- | --- | --- |
| buy_simple_01 | en | 3/3 | 100.0% | yes |
| buy_simple_02 | en | 3/3 | 100.0% | yes |
| fake_payment_01 | en | 1/3 | 100.0% | incomplete |
| negotiation_pushy_03 | en | 0/3 | N/A | incomplete |
| tradein_honest_01 | en | 3/3 | 100.0% | yes |
| tradein_lying_01 | en | 3/3 | 100.0% | yes |
| tradein_lying_02 | en | 3/3 | 100.0% | yes |
| tradein_lying_03 | en | 0/3 | N/A | incomplete |

### Baseline comparison

Fill this table with measured shop-hotline results before using it in a pitch.

| Shop hotline / service | Minutes to reach a human | Menu steps | Trade-in quote possible by phone (yes/no) |
| --- | --- | --- | --- |
| Shop hotline 1 | | | |
| Shop hotline 2 | | | |
| FlowQ | | | |

### Failures

- [negotiation_pushy_03 run 1](output/important/transcripts/negotiation_pushy_03_1.json): RuntimeError: /api/chat HTTP 502: Estimated cost cap reached; no further OpenAI requests will be made

### Measurement notes

Task success uses persisted orders, quotes, events and tool traces plus visible replies. pass^3 is measured only for scenarios with exactly three completed repeats; a single run is N/A. Budget-interrupted/skipped runs are incomplete, excluded from task-success denominators. Price flags check earlier tool amounts and correctly derived checkout totals; manual review is needed for unrecognized phrasing. Fixed backend notices also count as customer-visible mismatch communication. Tool latency includes local dispatch and provider latency where applicable; synthetic vision contributes no real vision latency. Cost uses per-model rates and provider-reported cached input; reservations never assume a cache hit.
