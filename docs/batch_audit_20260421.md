# First Production Batch Audit — 2026-04-21

Batch size: 50 items
Architecture: 方案 B (Engine does not write back to pipeline_state)
Prompt version: v3 (commit e401578) + v3 follow-up micro-fixes

---

## Headline Metrics

| Metric | v3 audit (2026-04-19) | **2026-04-21** | Delta |
|---|---|---|---|
| SEND (grounded) | 16 (32%) | **23 (46%)** | **+7 ✅** |
| SEND (acceptable fallback) | 11 (22%) | 16 (32%) | +5 |
| EDIT (name bug) | 17 (34%) | 11 (22%) | -6 ✅ |
| SKIP (EMPTY) | 6 (12%) | **0 (0%)** | **-6 ✅✅** |
| Decision language | 0 | 0 | ✅ |
| Banned phrase hits | 0 | 0 | ✅ |
| Fabrication | 0 | 0 | ✅ |
| Avg length (chars) | 155.5 | 156.2 | ≈ |
| Over 200 chars | 1 | 2 | +1 |

**Total SEND-ready: 27 → 39 (+12).** Most significant: EMPTY rate 12% → 0%; the 4 "persistent empties"
from v3 (Marie-Pier / Joseph Nassar / Mustafa / ZIG) all produced output.

---

## The only remaining quality issue: name bugs (11/50 = 22%)

11 messages had broken greetings where `customer_name_clean` equals `project_key`:

| AI output | Should have been |
|---|---|
| Hi Ann菲律宾, | Hi Ann, |
| Hi Mohamad澳大利亚, | Hi Mohamad, |
| Hi Cha菲律宾, | Hi Cha, |
| Hi Lee新西兰, | Hi Lee, |
| Hi Pem菲律宾, | Hi Pem, |
| Hi RK加拿大, | Hi RK, |
| Hi Melissa美国, | Hi Melissa, |
| Hi Darko美国, | Hi Darko, |
| **Hi Luke美国1台PC001,** | Hi Luke, |
| Hi +15616333305, | Hi there, |
| Hi +19542787594, | Hi there, |

### Root cause (diagnosed 2026-04-22)

Not a code bug in `cleanCustomerName()` — that function tests correctly in isolation for all 11 cases.
The bug is in the n8n **"Create a row"** Supabase node field binding:

```
fieldId: customer_name_clean
fieldValue: {{ $json.customer_name }}       ← WRONG: binds to raw name, shadowing API response
```

Fixed 2026-04-22 to:

```
fieldValue: {{ $json.customer_name_clean || $json.customer_name }}
```

This silently overwrote the API-cleaned `customer_name_clean` with the raw `customer_name` (which
equals project_key for most records), resulting in 100% of records having `customer_name_clean = project_key`.

---

## Plugin Sync Health

49 messages sent manually (Annabel skipped by design). 

| Status | Count | % |
|---|---|---|
| ✅ SYNCED + PS UPDATED | 41 | 84% |
| ⚠️ NOT SYNCED + PS UPDATED (n8n dispatch bug) | 3 | 6% |
| ❌ NOT SYNCED + PS STALE (Johnny forgot to send) | 4 | 8% |
| ❌ Orphan data (chat_id=null, cannot send) | 1 | 2% |

**Effective closed-loop rate: 44/49 = 90%.**

The 4 "Johnny forgot" cases were all high-value orders (HZ 10-unit, Krim 6-unit, Rocio 10-unit, Victor long timeline) — Johnny wanted to manually refine before sending, then lost track. All 4 have been individually snoozed on 2026-04-22 (see `ops/pool_snapshot_2026-04-22.md`).

---

## Business Insights

- Pool composition worked as expected under stage_priority ordering: 23 grounded (46%) + 27 fallback (54%)
- 7 messages had concrete deal details ($-amounts, model codes, postcodes) — these are the
  highest-leverage sends (Gabbie / Jade / HZ / Rocio / Krim / Filiz / 美国个人1台4月底5月初购买)
- All 4 persistent v3 EMPTY customers produced output, validating the "grounded fallback" design

## Post-batch actions taken

1. Individualized snooze for 5 failed customers (durations: 30d / 30d / 3mo / 18mo / permanent)
2. Added `snoozed_until` column + partial index to `pipeline_state`
3. Modified `followup_candidates` view to filter snoozed customers
4. Fixed n8n 'Create a row' node `customer_name_clean` field binding

## To verify in next batch (2026-04-27)

- `customer_name_clean = project_key` rate should be 0%
- All 5 snoozed customers should be excluded from the batch
- Pool size should be ~336 (386 - 50) plus cooldown-expired arrivals
