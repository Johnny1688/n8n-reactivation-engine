# Pool Snapshot — 2026-04-22 12:30 CST

Captured after deploying snooze mechanism + n8n customer_name_clean fix.
This is the baseline for comparison with the next batch (2026-04-27).

## Metrics

| Metric | Value | Note |
|---|---|---|
| pipeline_total | 683 | Active customers (excludes closed_won/lost/migrated) |
| pool_total (followup_candidates) | 386 | 56% of pipeline |
| snoozed_count | 5 | Manually set 2026-04-22 |

## Stage distribution in pool

| Stage | Count | % |
|---|---|---|
| ready | 1 | 0.3% |
| quoted | 0 | 0% |
| engaged | 161 | 41.7% |
| stalled | 217 | 56.2% |
| outreach | 7 | 1.8% |

## Interpretation

- **ready/quoted low is healthy**: Johnny is manually progressing high-value
  customers so they fall within cooldown period and are excluded from pool.
- **stalled dominates at 56%**: 14-day+ cooldown customers are the bulk of
  activation targets, which aligns with "reactivation" business goal.
- **engaged 42%**: These are warm customers who went silent in the last 7-14 days.
- **outreach only 7**: The 21-day cooldown + Johnny's manual follow-ups on
  new inquiries keep this bucket small.
- **Expected pool consumption rate**: 50/day → ~7-8 day full-cycle coverage,
  then customers re-enter cooldown windows.

## Currently snoozed customers

| Customer | snoozed_until | Reason |
|---|---|---|
| HZ加拿大10台（26.3.9日） | 2026-05-22 | Customer explicitly said waiting on expansion plans |
| Krim加拿大6台（26.2.23日） | 2026-05-22 | 5 follow-ups already sent, client silent 27 days after price answer |
| Rocio美国10台AR011 | 2026-08-01 | Opens studio in October, ship plan late Aug/early Sept |
| Victor美国 2028 | 2027-10-01 | Site not ready until 2028 |
| 未知号码 | 2099-01-01 | chat_id=null orphan data, effectively permanent exclusion |

## Questions to answer with next batch (2026-04-27)

1. Did `customer_name_clean` fix in n8n 'Create a row' node work? Target: 0 records with customer_name_clean = project_key
2. Were all 5 snoozed customers excluded from the batch? Target: 0 rows returned
3. Pool size after consumption + new cooldown-expired arrivals? Expected: ~336 + incoming
4. Which stage was consumed most? Expected: engaged > stalled (per stage_priority_score ordering)
