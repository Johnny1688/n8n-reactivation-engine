# Claude Sonnet 4.6 — System Issues Diagnosis

Batch: `samples/production_batch_claude_sonnet.json` (50 items)
Date: 2026-04-18

---

## Known Issues Check (from baseline v4)

### 1. "October arrival timing" Hallucination

**Sonnet result: 0 hallucinations (was 9 in baseline v4)**

October appears in exactly 1 message (Rocio), and it is legitimately grounded:
- Customer said: "Hi it will probably be late fall October"
- AI output: "…while you plan the October setup"

This is VERBATIM — not a hallucination. The baseline v4 had 9 customers where "October" was fabricated from project_key metadata. Sonnet 4.6 + current prompts have completely eliminated this.

### 2. Empty-Context Customers (no LCM + template LMM)

**Customers with empty LCM:** Charles, Glamour, +16477409299, +639773527833, +17802314545, Kristy, +14385095145, rehab Panhero — 8 total

**Fallback rate for these:** 6/8 correctly used FALLBACK (75%)

Exceptions:
- **Kristy** — fabricated "2 → 6 → 8 batch schedule" instead of using fallback (REWRITE)
- **rehab Panhero** — used a near-fallback variant ("Reformer price range wooden and aluminum") instead of exact template (EDIT — minor)

**Similarity among fallback messages:**
5 are the EXACT same message: "Hi there, I can share our most popular studio setup options so you can see what's a good fit — want me to send that here?"

This is correct behavior — they're using the prescribed fallback template. The identical output for zero-context customers is by design.

### 3. Not-Interested Customer Handling

**has_not_now_signal=true:** 2 customers (Bianca, Angelo)

| Customer | hnn | hns | AI Message | Assessment |
|---|---|---|---|---|
| Bianca | true | true | "just keeping the door open — whenever you're ready…" | Tone ✅ but template broken (no action/benefit/reply path) |
| Angelo | true | true | "I can keep the 15-unit AR011 vs AR004 comparison quote ready…" | Excellent — soft, grounded, correct tone |

**Missed not-now signals (hnn should be true but isn't):**
- **Dee** — customer said "we postpone the project because we're not financially prepared" → hnn=false (BUG)
- **+61480183422** — customer said "Sorry we just replaced all our reformer beds 3-4 months ago" → hnn=false (BUG)

Both cases: the AI message tone is actually appropriate (soft, no push), but the state flag is wrong. This is an upstream data issue, not a prompt issue.

### 4. hard_no_send=true Handling

**hard_no_send=true:** 2 customers (Bianca, Angelo) — same 2 as has_not_now_signal=true

Neither is EMPTY. Both generated messages:
- Bianca: soft door-open message (EDIT — template issue)
- Angelo: soft keep-ready message (EDIT — AR004 code issue)

This is CORRECT per EMPTY POLICY — hard_no_send should still produce a message, just with TIER 4 care tone. Both messages are appropriately soft.

---

## New Sonnet-Specific Patterns

### Pattern A: customer_name_clean Not Working (50/50 = 100%)

**Severity: P0 — data pipeline bug**

ALL 50 items have `customer_name_clean` equal to `project_key` (the full string with Chinese characters, dates, quantities). Examples:
- `customer_name_clean: "Marci加拿大1台（26.3.15日）"` (should be "Marci")
- `customer_name_clean: "Rocio美国10台AR011（26.3.16日）10月份左右开业"` (should be "Rocio")

Despite this, Sonnet correctly extracts first names in 35/46 non-empty cases (76%) — the model is compensating for the broken field by doing its own name extraction. This works now but is unreliable.

Cases where name extraction is notable:
- **+18163928158** → "Shalana" (found in conversation, phone number customer) ✅
- **Core1Pilates** → "Rick" (found in conversation, business name) ✅
- **C澳大利亚分销** → "Hi there" (correctly avoids using single letter "C") ✅
- **Glamour Beauty Zone** → "Hi" ❌ (should be "Hi there,")

### Pattern B: Decision-Requesting Language (4 cases = 8.7% of non-empty)

Messages that ask the customer to make a choice, violating "never ask for readiness / preference / comparison / new information / business decision":

| Customer | Phrase | Issue |
|---|---|---|
| Bash | "so you can tell me which fits your setup" | Asks customer to choose a price range |
| Raj | "before choosing between aluminum and wood" | Adds a decision customer didn't ask about |
| Sophie | "so you can pick the direction quickly" | Decision request |
| +18622675255 | "once I know your material and style preference" | Asks for new information |

### Pattern C: Repeating Already-Sent Information (3 cases = 6.5%)

The AI offers to "resend" or re-explain information already delivered in the last message:

| Customer | Already Sent | AI Offers |
|---|---|---|
| Bam | AR003 $613, AR011 $1207, PR007 $1572 | "resend the AR003 ($613), AR011 ($1,207), and PR007 ($1,572)" |
| +639563447450 | "customization options for size, branding, and features" | "walk you through exactly what our customization covers — size, branding, and features" |
| Shaq | "I'll share it with you now" + catalog | "put the catalog link and product photos into one clear message" |

The AI correctly identifies the anchor but doesn't recognize it's already been delivered. It should offer a NEXT STEP instead.

### Pattern D: Meta-Commentary / Internal Process Leakage (1 case)

| Customer | Phrase |
|---|---|
| Sophie | "I can skip the questions and just send you…" |

"skip the questions" references our internal qualification process. The customer doesn't know about our questions. This is process leakage into customer-facing copy.

### Pattern E: Overly Long Messages (1 case)

| Customer | Length | Issue |
|---|---|---|
| Core1Pilates | 242 chars | Lists 4 model codes, complex pricing structure language |

80-200 char guideline breached. Single case, but notable.

### Pattern F: EMPTY Despite Customer Context (4 cases = 8%)

All 4 EMPTY cases have customer messages that should produce at least a fallback:

| Customer | LCM | Should Produce |
|---|---|---|
| +14803263642 | "You're doing a great job, Johnny!" | Compliment → soft follow-up or fallback |
| Marie-Pier | "Private studio" | Purchase signal → studio setup message |
| MCD菲律宾 | "Studio Setup" | Purchase signal → studio setup message |
| Mustafa Çeçen | "Kanada" | Geographic info → Canadian delivery message |

None have hard_no_send=true. This appears to be a model-level generation failure where Sonnet returns empty despite the EMPTY POLICY prompt.

### Pattern G: Fabrication from Project Key Metadata (1 confirmed, 1 suspected)

| Customer | Fabricated Content | Source |
|---|---|---|
| Kristy | "2 → 6 → 8 batch schedule" | No evidence in LCM/LMM; "8" is from project key "8台" |
| +17325467528 | "when your listing goes live" | No evidence in LCM/LMM snippets; 需人工复核 |

Kristy's case is notable: the model invented a specific phased shipment plan (2→6→8) that doesn't appear anywhere in the available context. The "8" comes from the project key, but the phasing is pure fabrication.

---

## Comparison with Baseline v4

| Metric | Baseline v4 | Sonnet 4.6 | Delta |
|---|---|---|---|
| Total | 50 | 50 | — |
| SEND | 26 | 26 | = |
| EDIT | 16 | 17 | +1 |
| REWRITE | 8 | 3 | −5 (63% improvement) |
| SKIP | 0 | 4 | +4 (regression) |
| October hallucination | 9 | 0 | −9 (eliminated) |
| Banned phrase hits | 0 | 0 | = |
| FABRICATED anchor | ? | 1 | — |

Key improvements: October hallucination eliminated, REWRITE rate dropped 63%.
Key regression: 4 EMPTY outputs (was 0 in baseline v4). This is a net new bug category.
