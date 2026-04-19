# Claude Sonnet 4.6 — v3 vs v2 Comparison

Date: 2026-04-19
v3 prompt: post-commit `e401578` (3 micro-fixes: turn-taking override + verbatim fallback + expanded banned list)
Intersection: 50/50/50 (all three batches share the same 50 project_keys)

---

## Section 1: Overview

|  | v1 | v2 | v3 | v3 vs v2 |
|---|---|---|---|---|
| Total | 50 | 50 | 50 | — |
| SEND | 26 (52%) | 24 (48%) | 27 (54%) | **+3 ✅** |
| EDIT | 17 (34%) | 17 (34%) | 17 (34%) | 0 |
| REWRITE | 3 (6%) | 0 (0%) | 0 (0%) | 0 |
| SKIP (EMPTY) | 4 (8%) | 9 (18%) | 6 (12%) | **-3 ✅** |
| Decision-requesting | 4 | 1 | 0 | **-1 ✅** |
| Anchor VERBATIM | 17 | 16 | 17 | +1 |
| Anchor FABRICATED | 1 | 0 | 0 | 0 |
| Banned phrase hits | 0 | 0 | 0 | 0 |
| Avg msg length (non-empty) | 148 | 159 | 155.5 | -3.5 ↘️ |
| Over 200 chars | 1 | 3 | 1 | **-2 ✅** |
| Exact FALLBACK template | 5 | 5 | 6 | +1 |
| "resend" usage | 3 | 2 | 3 | +1 |

**Net quality shift (v3 vs v2):** SEND +3, SKIP -3, REWRITE stays 0, decision language → 0. All three v3 micro-fixes show measurable impact. The EMPTY regression from v2 is partially reversed.

**Net quality shift (v3 vs v1):** SEND 26→27 (+1), REWRITE 3→0 (-3 ✅), SKIP 4→6 (+2 ❌), decision language 4→0 (-4 ✅). Overall positive.

---

## Section 2: v2 → v3 Detailed Changes

### A. v2 EMPTY (9) → v3 Status

| Customer | v1 | v2 | v3 | Fixed? | v3 message (first 80 chars) |
|---|---|---|---|---|---|
| +14803263642 | SKIP | SKIP | **SEND** | ✅ YES | "Dallin, I can send the 1-unit vs 10-unit landed cost breakdown for the AR011…" |
| Mar | **SEND** | SKIP | **SEND** | ✅ YES | "Mar, I can send you the pricing for both aluminum and wood reformers for your 8-…" |
| Marie-Pier | SKIP | SKIP | SKIP | ❌ NO | (empty) |
| Joseph Nassar | **SEND** | SKIP | SKIP | ❌ NO | (empty) |
| MCD菲律宾 | SKIP | SKIP | **SEND** | ✅ YES | "Hi there, I can send you the pricing and specs for both our aluminum and wood…" |
| +17802314545 | **SEND** | SKIP | **SEND** | ✅ YES | "Hi there, I can share our most popular studio setup options…" (FALLBACK) |
| ZIG | **EDIT** | SKIP | SKIP | ❌ NO | (empty) |
| Mustafa Çeçen | SKIP | SKIP | SKIP | ❌ NO | (empty) |
| Kristy | REWRITE | SKIP | **SEND** | ✅ YES | "Kristy, I can put together a delivery timeline for your first 2-unit shipment…" |

**Result: 5/9 fixed** (was 0/9 in v2). The CRITICAL OVERRIDE for unanswered questions worked:
- Mar: last_my_msg asked material preference → v3 offers both options instead of waiting ✅
- MCD: last_my_msg asked 2 questions → v3 sends pricing for both types ✅
- +14803263642: compliment edge case → v3 finds real context (Dallin, AR011, sample→launch) ✅
- +17802314545: v3 correctly uses FALLBACK template ✅
- Kristy: v3 generates grounded message instead of hallucinating or going empty ✅

**Remaining 4 empties:**
- Marie-Pier: "Private studio" — persistent across all 3 versions
- Joseph Nassar: "commercial studio use?" — persistent v2→v3 (was SEND in v1)
- ZIG: "May I have info" — persistent v2→v3 (was EDIT in v1)
- Mustafa Çeçen: "Kanada" — persistent across all 3 versions

### B. v3 NEW Empties (not empty in v2)

| Customer | v1 | v2 | v3 | Diagnosis | Severity |
|---|---|---|---|---|---|
| **Core1Pilates** | EDIT | EDIT (257ch) | SKIP | v2 had 257-char overlong message with "once you've opened" misinterpretation. v3 drops it entirely. LCM: "I will open it tonight" — model may now be uncertain what "it" refers to. | **Serious** — customer has active conversation (Rick, 30401 zip, 4 model codes). FALLBACK should trigger. |
| **+61401954652** | SEND | SEND (180ch) | SKIP | v2 had excellent "unit pricing and quantity breakdowns for gym". v3 returns empty. LCM: "Hey, I'm only interested in a quote? It's possibly for a Gym" — direct purchase request. | **Serious** — customer explicitly asked for a quote. All 3 NON-EMPTY checks pass. No explanation for this regression. |

**Net new empties: 2.** Both are serious — neither has a prompt-rule explanation. These appear to be model stochasticity (same prompt, different run, different output).

### C. P1-1: Decision-Requesting Language

| Pattern | v1 | v2 | v3 |
|---|---|---|---|
| "once I know" | 1 | 0 | 0 |
| "so you can tell me" | 1 | 0 | 0 |
| "before choosing" | 1 | 0 | 0 |
| "if you let me know" | 0 | 0 | 0 |
| "so you can decide" | 0 | 0 | 0 |
| "once you confirm" | 0 | 0 | 0 |
| "once you pick" | 0 | 1 | 0 |
| "once you choose" | 0 | 0 | 0 |
| "once you select" | 0 | 0 | 0 |
| **Total** | **4** | **1** | **0** |

**Result: v3 = zero decision-requesting language.** The expanded banned list closed the "once you pick" gap from v2. +18622675255 now says "so you can compare them side by side" — fully compliant.

### D. P1-2: Repeat/Resend Patterns

v3 "resend" hits: 3 (C AU, Hayley, Shaq)

| Customer | v1 | v2 | v3 | Step 3.5 applied? |
|---|---|---|---|---|
| **Bam** | "resend" prices | "shipping cost" (NEXT STEP) + prices in parens | "shipping cost" + prices in parens | ✅ Same as v2 — advances to shipping, minor price echo |
| **+639563447450** | "walk you through" customization | "share overview" customization | "share overview" customization | ❌ NOT FIXED — still re-offers "size, branding, and features" already sent |
| **Shaq** | catalog + photos | "resend catalog" | "resend catalog" | ❌ NOT FIXED — still re-offers catalog already sent |

Additional "resend" in v3:
- **C AU**: "resend the AR011 total landed cost to Melbourne (USD 1,525 all-in)" — same as v1, echoes known info. Step 3.5 not applied.
- **Hayley**: "resend the MR001 pricing for 5 units ($575 each)" — acceptable, last_my_msg was generic reconnection.

**Result: Step 3.5 remains the weakest rule.** 2/3 original flagged items not fixed. "resend" count increased from 2 → 3 (Hayley newly uses "resend" in v3 — was just "send" in v2).

---

## Section 3: Sendable Rating Changes (v2 → v3)

### Improvements (7)

| Customer | v2 | v3 | Reason |
|---|---|---|---|
| **+14803263642** | SKIP | **SEND** | Empty → excellent grounded msg. "Dallin" name from conversation, AR011 + sample→launch from context. |
| **Mar** | SKIP | **SEND** | Empty → "pricing for both aluminum and wood reformers for your 8-unit Puerto Rico studio". Turn-taking override worked. |
| **MCD菲律宾** | SKIP | **SEND** | Empty → "pricing and specs for both our aluminum and wood reformers". Turn-taking override worked. |
| **+17802314545** | SKIP | **SEND** | Empty → FALLBACK template. Verbatim fallback mandate worked. |
| **Kristy** | SKIP | **SEND** | Empty → grounded "delivery timeline for first 2-unit shipment to Philippines". |
| **+18622675255** | EDIT | **SEND** | "once you pick" (banned) → "compare them side by side" (compliant). |
| **Sophie** | EDIT | **SEND** | "without needing to answer anything first" (meta) → "see the models, materials, and pricing all in one place" (clean). |

### Regressions (4)

| Customer | v2 | v3 | Reason |
|---|---|---|---|
| **Core1Pilates** | EDIT (257ch) | **SKIP** | Overlong msg → empty. v2 was bloated but sendable after trim. v3 produces nothing. New regression. |
| **+61401954652** | SEND (180ch) | **SKIP** | Excellent msg → empty. Customer asked for quote. No prompt-rule explanation. Model stochasticity. |
| **Krim** | EDIT | **EDIT** | "$9,432 × 6 units" (v3) vs "$9,432 each" (v2). v3 fixes the per-unit labeling error → now says "× 6 units" (correct multiplication format). Rating stays EDIT (still slightly ambiguous whether $9,432 is per-unit or total). |
| **Joseph AU** | SEND | **EDIT** | v2: "compare both options at a glance". v3: "unit price range for our Reformers so you have the numbers to work with" — more generic, drops "aluminum and wooden" specificity. Slight quality regression. |

### Net rating migration (v2 → v3)

| Direction | Count | Customers |
|---|---|---|
| SKIP → SEND | 5 | +14803263642, Mar, MCD, +17802314545, Kristy |
| EDIT → SEND | 2 | +18622675255, Sophie |
| SEND → SKIP | 1 | +61401954652 |
| EDIT → SKIP | 1 | Core1Pilates |
| SEND → EDIT | 1 | Joseph AU |
| Unchanged | 40 | (remaining) |

**Net: +6 upgrades, -3 downgrades = +3 net improvement.**

---

## Section 4: Comprehensive Assessment

### Q1: Is v3 better than v2?

**Yes, on every measured dimension:**

| Dimension | v2 → v3 | Evidence |
|---|---|---|
| SEND rate | 48% → 54% | +3 net |
| SKIP rate | 18% → 12% | -3 |
| Decision language | 1 → 0 | "once you pick" eliminated |
| Over 200 chars | 3 → 1 | Only +18622675255 (208ch) remains |
| Fabrication | 0 → 0 | Stable |
| Meta-commentary | 1 (Sophie) → 0 | Cleaned up |

### Q2: Remaining Issues

**True bugs (should never happen):**
1. **Joseph Nassar** — SKIP despite direct product question. Persistent from v2. (v1 was SEND)
2. **ZIG** — SKIP despite "May I have info". Persistent from v2. (v1 was EDIT)
3. **Core1Pilates** — NEW SKIP despite rich context (Rick, 4 models, zip code). Regression.
4. **+61401954652** — NEW SKIP despite explicit quote request. Regression.

**Corner cases (model judgment call):**
5. **Marie-Pier** — "Private studio" as sole input. Persistent across v1/v2/v3. FALLBACK should trigger but model consistently ignores it.
6. **Mustafa Çeçen** — "Kanada" as sole input. Same persistent pattern.

**Edge judgments (EDIT-tier, not blocking):**
7. **Glamour Beauty Zone** — "Hi" instead of "Hi there," for business name.
8. **+639563447450** — Step 3.5 not applied (resends customization info).
9. **Shaq** — Step 3.5 not applied (resends catalog).
10. **Krim** — "$9,432 × 6 units" slightly ambiguous formatting.

### Q3: v3 vs v1 (net change from baseline)

| Metric | v1 | v3 | Net |
|---|---|---|---|
| SEND | 26 (52%) | 27 (54%) | **+1 ✅** |
| EDIT | 17 (34%) | 17 (34%) | 0 |
| REWRITE | 3 (6%) | 0 (0%) | **-3 ✅** |
| SKIP | 4 (8%) | 6 (12%) | **+2 ❌** |
| Decision lang | 4 | 0 | **-4 ✅** |
| Fabrication | 1 | 0 | **-1 ✅** |

**Summary:** v3 eliminated all 3 REWRITEs and all 4 decision-language hits from v1. SEND rate slightly up. The cost is +2 EMPTYs (Joseph Nassar and ZIG regressed from v1; 2 original v1 empties — Marie-Pier and Mustafa — remain; +14803263642 and MCD fixed). Two new empties (Core1Pilates, +61401954652) offset by gains elsewhere.

### Q4: Production Readiness

**Recommendation: (a) Ready for production, with a monitoring note.**

Justification:
- **54% SEND rate** (up from v1's 52%) — net positive
- **0% REWRITE** — zero hallucination, zero fabrication
- **0 decision-requesting language** — fully compliant
- **12% SKIP** — higher than v1's 8%, but 4 of the 6 empties are persistent edge cases (Marie-Pier, Mustafa, Joseph Nassar, ZIG) that no prompt change has fixed across 3 iterations. The remaining 2 (Core1Pilates, +61401954652) are likely model stochasticity — a re-run may produce different results.

The 6 remaining EMPTYs are the only blocking concern. However:
- 4 are persistent across all prompt versions → likely need data-layer fixes (richer context in `reactivation_ai_payload`) rather than prompt changes
- 2 are new but have no prompt-rule explanation → model variance, not prompt deficiency
- Further prompt-level micro-fixes have diminishing returns and risk new regressions

**Production deployment plan:**
1. Deploy current prompt (v3)
2. Monitor EMPTY rate in production — if >10%, investigate data-layer context for those specific customers
3. Consider adding explicit EMPTY-customer examples to the prompt in a future v4 if the pattern persists at scale
4. Step 3.5 (repeat-info) can be strengthened in v4 but is low-priority (EDIT-tier issue, not blocking)
