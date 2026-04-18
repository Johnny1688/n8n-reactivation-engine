# Claude Sonnet 4.6 — v2 vs v1 Comparison

Date: 2026-04-18
v1 batch: `samples/production_batch_claude_sonnet.json` (pre-prompt-fix)
v2 batch: `samples/production_batch_claude_sonnet_v2.json` (post-commit `c68a70e` + `3f5ae77`)
Intersection: 50/50 (same 50 project_keys)

---

## 1. Overview

|  | v1 | v2 | Delta |
|---|---|---|---|
| Total | 50 | 50 | — |
| SEND | 26 (52%) | 24 (48%) | **-2 ❌** |
| EDIT | 17 (34%) | 17 (34%) | 0 |
| REWRITE | 3 (6%) | 0 (0%) | **-3 ✅** |
| SKIP (EMPTY) | 4 (8%) | 9 (18%) | **+5 ❌** |
| Anchor VERBATIM | 17 (34%) | 16 (32%) | -1 |
| Anchor CLOSE | 19 (38%) | 18 (36%) | -1 |
| Anchor FALLBACK | 9 (18%) | 7 (14%) | -2 |
| Anchor FABRICATED | 1 (2%) | 0 (0%) | **-1 ✅** |
| Anchor EMPTY | 4 (8%) | 9 (18%) | **+5 ❌** |
| Banned phrase hits | 0 | 0 | 0 |
| Avg msg length (non-empty) | 148 | 159 | +11 |
| Over 200 chars | 1 (Core1 242) | 3 (Bam 201, Sophie 211, Core1 257) | +2 |
| Exact FALLBACK template | 5 | 5 | 0 |

**Net quality shift:** REWRITE → 0 is a genuine win. But EMPTY +5 is a larger regression. The prompt fixes traded hallucination risk for empty-output risk.

---

## 2. P0-2: EMPTY Output (ABSOLUTE NON-EMPTY RULE)

### v1 EMPTY (4) → v2 status

| Customer | v1 | v2 | Fixed? | Diagnosis |
|---|---|---|---|---|
| +14803263642 | SKIP | SKIP | ❌ NO | Compliment edge case ("You're doing a great job"). Model doesn't recognize compliment as a conversation that needs follow-up. |
| Marie-Pier | SKIP | SKIP | ❌ NO | "Private studio" — single short reply. Model possibly confused by generic last_my_message (reconnection template). |
| MCD菲律宾 | SKIP | SKIP | ❌ NO | "Studio Setup" signal. Last_my_message asks 2 questions — model may think it's waiting for customer to answer. |
| Mustafa Çeçen | SKIP | SKIP | ❌ NO | "Kanada" — single word. Model doesn't treat it as sufficient context despite NON-EMPTY rule. |

**Result: 0/4 fixed.** The ABSOLUTE NON-EMPTY RULE had zero effect on the original 4 empties.

### v2 NEW empties (5 regressions)

| Customer | v1 Status | v1 Msg | v2 | Diagnosis |
|---|---|---|---|---|
| **Mar** | SEND | "shipping cost for 8 reformers to Puerto Rico" (132 ch) | SKIP | **Worst regression.** Customer said "Studio. 8 units. Puerto Rico." — 3 strong signals. Last_my_message asks material preference → model may think it's waiting for reply. |
| **Joseph Nassar** | SEND | "commercial studio reformer specs" (149 ch) | SKIP | Customer asked "Is your equipment designed for commercial studio use?" — direct question. No reason for empty. |
| **+17802314545** | SEND | Fallback template (121 ch) | SKIP | Zero-context customer. v1 correctly used fallback. v2 returns empty despite last_my_message existing (check 3 = YES). |
| **ZIG** | EDIT | "Pilates Reformer options for the US" (134 ch) | SKIP | Customer said "May I have info". Last_my_message asks qualifying questions → model may think it's waiting for reply. |
| **Kristy** | REWRITE | Fabricated "2→6→8 batch schedule" (171 ch) | SKIP | v1 hallucinated. v2 correctly avoids hallucination but fails to use FALLBACK. project_key has "8台工作室" (structured info, check 2 = YES). |

### Root cause pattern

3 of the 5 new empties (Mar, MCD, ZIG) share a common pattern: **the last_my_message asks the customer a question** (material preference, 2 qualifying questions, model recommendation question). The model appears to interpret this as "I asked a question and the customer hasn't answered yet → I shouldn't send another message."

This is NOT a prompt-rule failure — the 3-point check passes for all cases. The model is applying a conversational turn-taking heuristic that overrides the NON-EMPTY rule.

**Recommended fix:** Add an explicit override: "Even if your last message asked a question that the customer has not answered, you MUST still generate a message. Treat the unanswered question as a dead thread and offer something new."

---

## 3. P1-1: Decision-Requesting Language (NO-DECISION RULE)

### v1 flagged (4) → v2 status

| Customer | v1 phrase | v2 phrase | Fixed? |
|---|---|---|---|
| **+18622675255** | "once I know your material and style preference" | "once you pick aluminum, wood, or stainless" | ⚠️ PARTIAL — still conditional ("once you pick") but now lists specific options |
| **Bash** | "so you can tell me which fits your setup" | "so you can see which range fits your budget" | ✅ FIXED — delivers info, doesn't ask for input |
| **Raj** | "before choosing between aluminum and wood" | "so you can see the full picture for your 10-unit setup" | ✅ FIXED — delivers comparison, no decision request |
| **Sophie** | "pick the direction quickly" / "skip the questions" | "compare them side by side without needing to answer anything first" | ⚠️ PARTIAL — no decision request, but "without needing to answer anything first" is meta-commentary |

### v2 decision-language grep (banned patterns)

| Pattern | v1 hits | v2 hits |
|---|---|---|
| "once I know" | 1 | 0 |
| "so you can tell me" | 1 | 0 |
| "before choosing" | 1 | 0 |
| "if you let me know" | 0 | 0 |
| "so you can decide" | 0 | 0 |
| "once you confirm" | 0 | 0 |
| **Semantic equivalent: "once you pick"** | 0 | 1 |
| **Total** | **4** | **1** |

**Result: 3/4 fully fixed, 1/4 partially fixed.** Decision-requesting language dropped from 4 → 1. The NO-DECISION RULE is working well. The remaining case (+18622675255) uses "once you pick" which is a semantic equivalent not on the explicit banned list.

**Recommended fix:** Add "once you pick / once you choose / once you select" to the banned list.

---

## 4. P1-2: Repeating Already-Sent Info (Step 3.5 NEXT STEP)

### v1 flagged (3) → v2 status

#### Bam — ⚠️ PARTIALLY FIXED

**v1:** Bam, I can resend the AR003 ($613), AR011 ($1,207), and PR007 ($1,572) unit prices here so you can compare them side by side — want me to send that?
**v2:** Bam, I can send the shipping cost to your US location for AR003 ($613), AR011 ($1,207), and PR007 ($1,572) so you can see the full landed price for your 8-unit studio setup — want me to send that here?

**Analysis:** The main action correctly advances to "shipping cost" (NEXT STEP ✅). But the already-sent prices ($613/$1,207/$1,572) are still listed in parentheses — minor redundancy. The step 3.5 rule is partially applied.

#### +639563447450 — ❌ NOT FIXED

**v1:** Hi there, I can walk you through exactly what our customization covers — size, branding, and features — so you can see what's possible for your needs — want me to send that here?
**v2:** Hi there, I can share a quick overview of our customization options — size, branding, and features — so you can see exactly what's possible for your needs — want me to send that here?

**Analysis:** Different verb ("walk you through" → "share a quick overview") but identical content: "size, branding, and features" — which was ALREADY provided in last_my_message. Should offer next step: "send photos of recent custom branding projects" or "show you a customization example."

#### Shaq — ❌ NOT FIXED

**v1:** Shaq, I can put the catalog link and product photos into one clear message so you can browse without digging back — want me to send that here?
**v2:** Shaq, I can resend the catalog link here so you have it in one place whenever you're ready to browse — want me to drop it here?

**Analysis:** Both offer the catalog that was already sent. v2 is honest about "resend" but doesn't advance to NEXT STEP. Should offer: "highlight top picks for your use case" or "send photos of specific models that match your needs."

**Result: 1/3 partially fixed, 2/3 not fixed.** Step 3.5 had limited impact. The rule may need stronger wording or concrete examples matching these exact scenarios.

---

## 5. Sendable Rating Changes (v1 → v2)

### Improvements (8)

| Customer | v1 | v2 | Reason |
|---|---|---|---|
| Bash | EDIT | **SEND** | P1-1 fixed: "tell me which fits" → "see which range fits your budget" |
| Raj | EDIT | **SEND** | P1-1 fixed: "before choosing" → "see the full picture" |
| Shirley | EDIT | **SEND** | Removed "daily-use durability specs" embellishment |
| +18622675255 | REWRITE | **EDIT** | Decision language improved (lists specific options instead of vague "preference") |
| Shalana (#13) | SEND | SEND | Wording improved ("before deciding" removed) — no rating change |
| Sid (#14) | SEND | SEND | Wording improved ("lock in" pressure removed) — no rating change |
| Kirra (#8) | SEND | SEND | Wording improved ("before deciding" → "in one message") — no rating change |
| Kristy | REWRITE | **SKIP** | Stopped hallucinating (good) but now empty (bad) — ambiguous |

*Note: Several SEND→SEND improvements in wording are not captured by rating changes.*

### Regressions (7)

| Customer | v1 | v2 | Reason |
|---|---|---|---|
| **Mar** | **SEND** | **SKIP** | Excellent 132-char message → empty. Last_my_msg asked question → model thinks it's waiting. |
| **Joseph Nassar** | **SEND** | **SKIP** | Excellent 149-char message → empty. Customer asked direct product question. |
| **+17802314545** | **SEND** | **SKIP** | Fallback template → empty. Zero-context but v1 handled correctly. |
| **ZIG** | **EDIT** | **SKIP** | 134-char message → empty. Customer asked for info. |
| **Krim** | **SEND** | **EDIT** | Added specific dollar amounts but "$9,432 each" is mislabeled (should be total, not per-unit). |
| **C AU** | **SEND** | **EDIT** | Now echoes our own last_my_message (video offer) instead of offering different info. |
| **Kristy** | **REWRITE** | **SKIP** | Stopped hallucinating but no FALLBACK either — debatable. |

### Net rating migration

| Direction | Count | Customers |
|---|---|---|
| REWRITE → EDIT | 1 | +18622675255 |
| REWRITE → SKIP | 1 | Kristy |
| EDIT → SEND | 3 | Bash, Raj, Shirley |
| SEND → EDIT | 2 | Krim, C AU |
| SEND → SKIP | 3 | Mar, Joseph Nassar, +17802314545 |
| EDIT → SKIP | 1 | ZIG |
| Unchanged | 39 | (remaining) |

---

## 6. New Issues in v2 (not present in v1)

### FALLBACK template not triggered for empties

The NON-EMPTY rule mandates using the FALLBACK template when the 3-point check passes. But 5 new empties appeared. The FALLBACK template count stayed at 5 (same customers in both batches). This means the rule is being **ignored** — the model either doesn't reach the 3-point check, or a stronger heuristic (turn-taking) overrides it.

### Pricing error (Krim)

v2 introduced "$9,432 each" which is factually wrong ($9,432 is the total for 6 × PR007, not per-unit). v1 avoided this by not quoting specific dollar amounts. This is a new fabrication-adjacent error — the model grabbed a number from the customer's message and misattributed it.

### Meta-commentary persists (Sophie)

v1: "skip the questions" → v2: "without needing to answer anything first". Different words, same conceptual leak. The model is aware of its internal process and leaks it into the message.

### Message length inflation

v2 averages 159 chars (v1: 148). Three messages exceed 200 chars (v1: one). The additional prompt constraints may be pushing the model to over-explain.

---

## 7. Top 3 Regressions (v1 vs v2 message comparison)

### #1 Mar — SEND → SKIP (most damaging)

**v1:** Mar, I can send you the shipping cost for 8 reformers to Puerto Rico so you can plan your studio budget — want me to send that here?
**v2:** (empty)

Customer context: "Studio. 8 units. Puerto Rico." — three concrete purchase signals. v1 produced a perfect 132-char message grounded in all three. v2 returns nothing.

### #2 Joseph Nassar — SEND → SKIP

**v1:** Joseph, I can share our commercial studio reformer specs so you can confirm the equipment fits your daily training setup — want me to send that here?
**v2:** (empty)

Customer asked "Is your equipment designed for commercial studio use?" — a direct product question. v1 answered it perfectly. v2 returns nothing.

### #3 +17802314545 — SEND → SKIP

**v1:** Hi there, I can share our most popular studio setup options so you can see what's a good fit — want me to send that here?
**v2:** (empty)

Zero-context customer where v1 correctly used the exact fallback template. v2 fails to even produce a fallback. This is the simplest case — zero ambiguity.

---

## 8. Top 3 Improvements (v1 vs v2 message comparison)

### #1 Bash — EDIT → SEND (P1-1 fix)

**v1:** Bash, I can put the three Sydney studio price ranges (USD 450–700 / 700–1,200 / 1,200+) into one quick message so you can tell me which fits your setup — want me to send that here?
**v2:** Bash, I can send the MR001, AR001, and AR011 unit prices for your Sydney studio setup so you can see which range fits your budget — want me to send that here?

"tell me which fits" (decision request) → "see which range fits your budget" (info delivery). Also switches from vague price ranges to specific model codes.

### #2 Raj — EDIT → SEND (P1-1 fix)

**v1:** Raj, I can send you the pricing and shipping cost to Boston for 10 units so you can see the full picture before choosing between aluminum and wood — want me to send that here?
**v2:** Raj, I can send the pricing and shipping cost to Boston for one aluminum and one wood studio reformer side by side so you can see the full picture for your 10-unit setup — want me to send that here?

"before choosing between" (conditional) → "side by side so you can see the full picture" (delivers both unconditionally).

### #3 SE7EN — SEND → SEND (step 3.5 applied, quality upgrade)

**v1:** SE7EN, I can send you the beech vs maple price comparison for your 8-unit studio setup so you can pick the right wood type at a glance — want me to send that here?
**v2:** SE7EN, I can send the shipping cost to your US location for your 8 beech reformers so you can see the full landed price alongside the $4,200 total — want me to send that here?

v1 offered a comparison the customer didn't ask for (beech vs maple — customer already chose beech). v2 correctly advances to shipping cost (NEXT STEP) and references the $4,200 total from conversation. This is exactly how step 3.5 should work.

---

## 9. Production Readiness Assessment

### Scorecard

| Metric | v1 | v2 | Verdict |
|---|---|---|---|
| SEND rate | 52% | 48% | ❌ Worse |
| REWRITE rate | 6% | 0% | ✅ Better |
| SKIP rate | 8% | 18% | ❌ Worse |
| Decision language | 4 hits | 1 hit | ✅ Better |
| P1-2 repeat fix | 0/3 | 1/3 partial | ⚠️ Marginal |
| Fabrication | 1 | 0 | ✅ Better |
| Pricing error | 0 | 1 (Krim) | ❌ New |
| Avg length | 148 | 159 | ⚠️ Longer |
| Over 200 chars | 1 | 3 | ❌ Worse |

### Recommendation: **(b) One more micro-tuning round before production**

The current prompt is NOT ready for production due to the EMPTY regression (+5). The P1-1 fix (decision language) works well. The P0-2 fix (NON-EMPTY rule) backfired — it had zero effect on original empties and may have contributed to new ones.

### Specific next steps

1. **Fix the EMPTY regression (critical, P0)**
   - Add to prompt: "Even if your last message asked a question that the customer has not answered, you MUST still generate a message. Do not wait for an answer — treat the unanswered question as expired and offer something new."
   - This addresses the root cause (turn-taking heuristic) found in 3/5 new empties.

2. **Strengthen FALLBACK mandate**
   - Currently the NON-EMPTY rule says "MUST use the FALLBACK template" but the model ignores it.
   - Add: "If you cannot think of a specific anchor, copy the FALLBACK template VERBATIM — character by character — with only the [Name] replaced. An exact copy of the fallback is always better than an empty message."

3. **Close the "once you pick" loophole**
   - Add "once you pick / once you choose / once you select" to the banned phrase list in the NO-DECISION rule.

4. **Do NOT roll back P1-1 or step 3.5** — both show positive impact where they apply.

### Rules assessment

| Rule | Impact | Keep? |
|---|---|---|
| ABSOLUTE NON-EMPTY RULE | No effect on originals, didn't prevent 5 new empties | Keep but **strengthen** |
| NO-DECISION RULE | 3/4 fixed, 1 semantic gap | Keep, **add patterns** |
| Step 3.5 NEXT STEP | 1/3 partially fixed (Bam), 1 excellent application (SE7EN) | Keep, **add examples** |
