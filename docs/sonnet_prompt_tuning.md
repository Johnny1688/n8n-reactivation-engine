# Claude Sonnet 4.6 — Prompt Tuning Recommendations

Batch: `samples/production_batch_claude_sonnet.json` (50 items)
Date: 2026-04-18

---

## P0 — Critical (fix immediately)

### P0-1: customer_name_clean field not populated

**Problem:** `customer_name_clean` equals `project_key` for all 50 items. The `cleanCustomerName()` function in `api/build-context.js` is not being called, or this batch was produced from a pipeline stage that doesn't include it.

**Impact:** 50/50 items (100%). The AI model is compensating by extracting names from project_key strings, which works ~76% of the time but is unreliable (Glamour Beauty Zone → "Hi" instead of "Hi there,").

**Typical cases:** Every single item. Marci's `customer_name_clean` is "Marci加拿大1台（26.3.15日）" instead of "Marci".

**Root cause:** Not a prompt issue — this is a data pipeline issue. The n8n workflow node that calls build-context.js may not be using the latest version, or the Supabase export happened before the `customer_name_clean` field was added.

**Fix:**
1. Verify the n8n Build AI Context node is using the latest `api/build-context.js` with `cleanCustomerName()`
2. Verify `customer_name_clean` appears in the n8n node output
3. Verify `enforce_quality_user.txt` template uses `{{$json.customer_name_clean || $json.customer_name || ''}}`

**Expected improvement:** Name errors drop from ~24% to ~0%.

---

### P0-2: EMPTY output despite EMPTY POLICY (4 cases)

**Problem:** 4 customers received empty ai_message despite the EMPTY POLICY explicitly forbidding it. All 4 have customer context that should produce at least a fallback.

**Impact:** 4/50 items (8%). These customers get no activation message at all.

**Typical cases:**
- Marie-Pier (LCM: "Private studio") — clear purchase signal
- MCD菲律宾 (LCM: "Studio Setup") — clear purchase signal
- Mustafa Çeçen (LCM: "Kanada") — geographic info
- +14803263642 (LCM: "You're doing a great job, Johnny!") — edge case

**Root cause:** `prompts/reactivation_system.txt` — the EMPTY POLICY section may not be emphatic enough, or the model is interpreting ambiguous signals as reasons to produce nothing.

**Fix in `prompts/reactivation_system.txt`:**

Before (current OUTPUT DISCIPLINE, ~L319):
```
Return JSON only. No analysis, no notes, no extra keys.
```

After:
```
Return JSON only. No analysis, no notes, no extra keys.

ABSOLUTE RULE: The whatsapp_message field MUST contain a non-empty string.
If you are about to return an empty whatsapp_message, STOP and use the FALLBACK template instead.
There is NO scenario where empty output is acceptable.
```

Also add to the INTERNAL REASONING section (~L34):
```
0. PRE-CHECK: Am I about to return empty? If yes → STOP → use FALLBACK template.
```

**Expected improvement:** EMPTY rate drops from 8% to 0%.

---

## P1 — Important (fix in next iteration)

### P1-1: Decision-requesting language bypasses prompt guardrails

**Problem:** 4 messages ask the customer to make a choice or provide new information, violating the "answerable in under 3 seconds" rule.

**Impact:** 4/46 non-empty items (8.7%).

**Typical cases:**
- **+18622675255:** "once I know your material and style preference" — asks for info
- **Bash:** "so you can tell me which fits your setup" — asks for decision
- **Raj:** "before choosing between aluminum and wood" — introduces a decision

**Root cause:** `prompts/reactivation_system.txt` — the constraint against asking questions is in the VALIDATION RULES but the model sometimes adds conditional language ("once I know…", "before choosing…") that technically isn't a question mark but still burdens the customer.

**Fix in `prompts/reactivation_system.txt`, GROUNDING RULE section:**

Add after the existing action/benefit rules:
```
NEVER use conditional language that requires customer input before you can act:
- ❌ "once I know your preference"
- ❌ "before choosing between X and Y"
- ❌ "so you can tell me which"
- ❌ "if you let me know your..."
- ✅ "so you can compare" (passive — customer doesn't need to reply to get value)
- ✅ "so you can see the options" (passive)

The message must offer to SEND something, not ask for something.
```

**Expected improvement:** Decision-requesting language drops from 8.7% to <2%.

---

### P1-2: Repeating already-delivered information

**Problem:** AI offers to "resend" information that was already delivered in the last seller message. The customer already has this info — the message wastes their time.

**Impact:** 3/46 non-empty items (6.5%).

**Typical cases:**
- **Bam:** Prices already sent → AI offers to resend same prices
- **+639563447450:** Customization details already answered → AI offers to re-explain
- **Shaq:** Catalog already shared → AI offers to reshare

**Root cause:** `prompts/reactivation_system.txt` — the GROUNDING RULE focuses on finding an anchor in conversation but doesn't check if that anchor was ALREADY delivered.

**Fix in `prompts/reactivation_system.txt`, INTERNAL REASONING section:**

Add as reasoning step 3.5:
```
3.5. Was this anchor already delivered in my last message?
    If YES → Do NOT offer to "resend" or "reshare" the same thing.
    Instead, find the NEXT logical step:
    - If price was sent → offer shipping cost or payment terms
    - If catalog was sent → offer to highlight top picks for their use case
    - If specs were answered → offer photos or video
    - If nothing else → offer to answer any follow-up questions with a simple reply
```

**Expected improvement:** Repeat-info messages drop from 6.5% to ~0%.

---

### P1-3: Bianca template structure violation (hard_no_send pattern)

**Problem:** Bianca's message ("just keeping the door open — whenever you're ready to explore options again, I'm here. No rush at all.") completely breaks the required template structure: missing [action] + [benefit] + [reply path].

**Impact:** 1/2 hard_no_send cases (50% of this critical category).

**Typical case:** Bianca Wallace — hns=true, hnn=true.

**Root cause:** `prompts/reactivation_system.txt` FALLBACK section and `prompts/enforce_quality_system.txt` REWRITE RULES section — the TIER 4 not-now template is provided but the model sometimes generates a "door open" style message instead.

**Fix in `prompts/reactivation_system.txt`, FALLBACK section:**

Add explicit negative example:
```
For has_not_now_signal = true OR hard_no_send = true:

❌ NEVER use freeform "door open" messages like:
"[Name], just keeping the door open — whenever you're ready to explore options again, I'm here."
(This has no action, no benefit, no reply path.)

✅ ALWAYS use the TIER 4 template:
"[Name], I can keep [concrete object from history] ready so you can [future use case] — want me to send that here?"
```

**Expected improvement:** 100% of hard_no_send messages follow required template structure.

---

## P2 — Nice to Have (fix when convenient)

### P2-1: Meta-commentary / internal process leakage

**Problem:** Sophie's message says "I can skip the questions" — referencing our internal qualification process. Customer doesn't know about our questions.

**Impact:** 1/46 (2.2%). Single case.

**Typical case:** Sophie — "I can skip the questions and just send you the top 2 reformer options"

**Root cause:** `prompts/reactivation_system.txt` — no explicit rule against referencing internal process.

**Fix in `prompts/reactivation_system.txt`, OUTPUT DISCIPLINE section:**

Add:
```
NEVER reference internal processes the customer doesn't know about:
- ❌ "skip the questions"
- ❌ "cut through the back-and-forth"
- ❌ "instead of going through the full process"
The customer should never feel they're part of a sales workflow.
```

**Expected improvement:** Process leakage eliminated.

---

### P2-2: "Hi" vs "Hi there," inconsistency for business names

**Problem:** Glamour Beauty Zone gets "Hi," instead of "Hi there," — missing the comma-space after "there" per NAME SANITIZATION RULE.

**Impact:** 1/46 (2.2%). Single case.

**Typical case:** Glamour Beauty Zone → "Hi, I can share what's new…"

**Root cause:** `prompts/reactivation_system.txt` NAME SANITIZATION RULE — the rule says use "Hi there" for business names, but the model sometimes shortens to just "Hi".

**Fix in `prompts/reactivation_system.txt`, CRITICAL NAME RULE:**

Add to INVALID examples:
```
❌ "Hi, I can..." (missing "there")
✅ "Hi there, I can..." (correct format)

The greeting is ALWAYS either "[Name]," or "Hi there," — never just "Hi,".
```

**Expected improvement:** Greeting format consistency reaches 100%.

---

### P2-3: Message too long (>200 chars)

**Problem:** Core1Pilates message is 242 chars with 4 model codes.

**Impact:** 1/46 (2.2%). Single case.

**Typical case:** Core1Pilates — "Rick, once you've opened it, I can put together a quick per-unit landed cost breakdown (product + shipping) for AR001, AR011, FR001, and FR004 so you can clearly see the margin on each for your next customer order — want me to send that here?"

**Root cause:** `prompts/reactivation_system.txt` — word count guidance says "roughly 16-30 words" but doesn't enforce a hard character limit.

**Fix in `prompts/enforce_quality_system.txt`, VALIDATION RULES:**

Add:
```
Length hard limit: If the message exceeds 200 characters, REWRITE shorter.
- Pick the 1-2 most important model codes, not all of them
- Simplify compound benefit clauses
```

**Expected improvement:** All messages under 200 chars.

---

### P2-4: Fabrication from project key metadata

**Problem:** Kristy's message includes "2 → 6 → 8 batch schedule" — a specific logistics plan that doesn't appear in conversation context.

**Impact:** 1/46 (2.2%). Single case (confirmed). 1 suspected (+17325467528 "listing goes live").

**Typical case:** Kristy — LCM empty, LMM is generic template, but AI generates highly specific phased shipment plan.

**Root cause:** `prompts/reactivation_system.txt` ANCHOR PRE-CHECK — the pre-check lists "specific timing" and "specific quantity" as valid anchors, but doesn't distinguish between customer-stated info and project_key metadata. The model may be extracting "8台" from the project key and fabricating a phasing plan around it.

**Fix in `prompts/reactivation_system.txt`, ANCHOR PRE-CHECK:**

Add clarification:
```
IMPORTANT: Anchors must come from the CONVERSATION (customer messages or seller messages), 
NOT from the project_key field or other metadata fields.
The project_key often contains Chinese annotations (e.g. "Kristy菲律宾8台工作室") — 
these are internal notes, NOT things the customer said.
Do NOT extract model codes, quantities, or dates from the project_key to use as anchors.
```

**Expected improvement:** Metadata-based fabrication eliminated.

---

## Priority Matrix

| ID | Priority | Impact | Effort | Category |
|---|---|---|---|---|
| P0-1 | P0 | 100% | Low | Data pipeline |
| P0-2 | P0 | 8% | Low | Prompt — reactivation_system.txt |
| P1-1 | P1 | 8.7% | Low | Prompt — reactivation_system.txt |
| P1-2 | P1 | 6.5% | Medium | Prompt — reactivation_system.txt |
| P1-3 | P1 | 50% of hns | Low | Prompt — reactivation_system.txt |
| P2-1 | P2 | 2.2% | Low | Prompt — reactivation_system.txt |
| P2-2 | P2 | 2.2% | Low | Prompt — reactivation_system.txt |
| P2-3 | P2 | 2.2% | Low | Prompt — enforce_quality_system.txt |
| P2-4 | P2 | 2.2% | Low | Prompt — reactivation_system.txt |
