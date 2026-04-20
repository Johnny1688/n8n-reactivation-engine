# Customer Profile Subsystem — Design Spec

Last updated: 2026-04-20 (v1.1)
Status: **Approved for implementation (Day 1 start)**
Owner: Johnny

Change log:
- v1.2 (2026-04-20): DB infra deployed. conversation_summary migrated TEXT → JSONB (with view rebuild). 5 btree expression indexes created. Spec §2 corrected from "GIN" to "btree expression indexes" (->> returns scalar text, btree is the right tool).
- v1.1 (2026-04-20): Added `sample_request_status` and `return_exchange_history` as first-class fields in `intelligence`. Added return/exchange safety gate in Reactivation Engine.
- v1.0 (2026-04-20): Initial spec.

---

## 1. Purpose

Turn raw WhatsApp/email message history into a structured, queryable customer profile stored in `pipeline_state.conversation_summary`. Profile drives three downstream consumers:

1. **Reactivation Engine** — injects profile into activation prompt (`Who` layer) so generated messages are customer-specific
2. **Weekly Report** — aggregates profiles across customers to surface top opportunities, leakage risks, and patterns
3. **Ad-hoc querying** — structured fields allow SQL filtering (e.g., all value_tier=A customers in Canada with decision_horizon ≤ 3mo)

**Primary product** = structured asset for aggregation/querying.
**Secondary product** = better activation messages.

Do not invert this priority when making trade-offs.

---

## 2. Schema (LOCKED — v1)

Stored as JSONB in `pipeline_state.conversation_summary`.

```json
{
  "schema_version": 1,
  "profile_version": 1,
  "generated_at": "2026-04-20T09:00:00Z",
  "generation_mode": "full",
  "source_message_count": 87,

  "identity": {
    "customer_type": "studio_owner",
    "country": "CA",
    "region": "Vancouver",
    "business_stage": "launching",
    "decision_role": "owner",
    "language_preference": "en"
  },

  "commercial": {
    "budget_tier": "mid",
    "volume_signal": "10-29",
    "target_models": ["MR-series"],
    "material_preference": "wood",
    "style_preference": ["core_reformer"],
    "shipping_term": "DDP",
    "pricing_sent": true,
    "last_quote_ref": "Q-2026-0412-Alex",
    "competitors_mentioned": ["Balanced Body"]
  },

  "timeline": {
    "decision_horizon": "1-3mo",
    "urgency_signals": ["studio opening May 2026"],
    "last_inbound_at": "2026-04-18T14:22:00Z",
    "last_outbound_at": "2026-04-19T09:11:00Z"
  },

  "state": {
    "current_stage": "quoted",
    "open_objections": ["shipping cost to Vancouver"],
    "verification_status": "none",
    "outstanding_asks": ["DDP quote for 12 units"],
    "outstanding_asks_from_us": []
  },

  "intelligence": {
    "value_tier": "A",
    "win_probability": 0.55,
    "key_risks": ["competitor Balanced Body in consideration"],
    "leverage_points": ["wood preference aligns with MR-series", "multi-store expansion plan"],
    "recommended_next_move": "send DDP quote with lead-time advantage vs Balanced Body",
    "sample_request_status": "none",
    "return_exchange_history": {
      "has_history": false,
      "cases": []
    }
  },

  "narrative": "Alex 是温哥华精品工作室老板,5 月开业,首批 12 台木制 Reformer,偏好 MR 系列。4/15 DDP 报价已发,等合伙人内部评估。竞品 Balanced Body 因交期 12 周处于劣势。主要未决点是运费。",

  "key_quotes": [
    {"date": "2026-04-10", "quote": "we need them by early May, no flexibility"},
    {"date": "2026-04-15", "quote": "the wooden one looks much better for our brand"}
  ],

  "extensions": {}
}
```

### Enum values (strict)

| Field | Allowed values |
|---|---|
| `identity.customer_type` | `studio_owner`, `distributor`, `ecommerce`, `reseller`, `unclear` |
| `identity.business_stage` | `launching`, `expanding`, `replacing`, `exploring`, `unknown` |
| `identity.decision_role` | `owner`, `buyer`, `influencer`, `unclear` |
| `identity.language_preference` | ISO 639-1 2-letter code |
| `commercial.budget_tier` | `low`, `mid`, `high`, `unknown` |
| `commercial.volume_signal` | `1-9`, `10-29`, `30-99`, `100+`, `unknown` |
| `commercial.material_preference` | `aluminum`, `wood`, `stainless`, `mixed`, `undecided` |
| `commercial.shipping_term` | `FOB`, `CIF`, `DDP`, `EXW`, `unknown` |
| `timeline.decision_horizon` | `immediate`, `1-3mo`, `3-6mo`, `6mo+`, `unclear` |
| `state.verification_status` | `none`, `requested`, `video_offered_pending`, `evidence_sent`, `satisfied` |
| `intelligence.value_tier` | `A`, `B`, `C` |
| `intelligence.win_probability` | float, 0.0–1.0 |
| `intelligence.sample_request_status` | `none`, `inquired`, `quoted`, `paid`, `shipped`, `received`, `declined` |
| `generation_mode` | `full`, `incremental` |

### `intelligence.return_exchange_history` shape

```json
{
  "has_history": true,
  "cases": [
    {
      "date": "2026-03-12",
      "type": "return",
      "item": "MR-series footbar",
      "reason": "damaged in transit",
      "resolution": "replaced free, shipped 2026-03-20",
      "status": "resolved"
    }
  ]
}
```

Allowed values:
- `type`: `return`, `exchange`, `partial_refund`, `warranty_claim`
- `status`: `open`, `resolved`, `disputed`, `abandoned`

If no history: `{"has_history": false, "cases": []}`.

These two fields are **first-class** because they materially change activation tone. A customer with an open return case must never receive a generic "just checking in" message — the Reactivation Engine should see the case and either (a) skip activation until resolved, or (b) lead with resolution status.

### Indexes (required)

Btree expression indexes on JSONB paths. The `->>` operator extracts a single text scalar, so btree (Postgres default) is the right index type — GIN would be overkill and waste space.

```sql
CREATE INDEX IF NOT EXISTS idx_profile_value_tier
  ON pipeline_state ((conversation_summary->'intelligence'->>'value_tier'));

CREATE INDEX IF NOT EXISTS idx_profile_decision_horizon
  ON pipeline_state ((conversation_summary->'timeline'->>'decision_horizon'));

CREATE INDEX IF NOT EXISTS idx_profile_country
  ON pipeline_state ((conversation_summary->'identity'->>'country'));

CREATE INDEX IF NOT EXISTS idx_profile_sample_status
  ON pipeline_state ((conversation_summary->'intelligence'->>'sample_request_status'));

CREATE INDEX IF NOT EXISTS idx_profile_has_return_history
  ON pipeline_state ((conversation_summary->'intelligence'->'return_exchange_history'->>'has_history'));
```

### Extension strategy

Unknown or future fields go into `extensions` (free-form object). Do **not** bump `schema_version` for additive changes. Only bump when a field is moved from `extensions` into a first-class slot, or when an enum value is removed.

---

## 3. Model assignments

| Task | Model | Max tokens in/out |
|---|---|---|
| Profile v1 (full) | `claude-sonnet-4-6` | 8K / 2K |
| Profile update (incremental) | `claude-haiku-4-5` | 3K / 1.5K |
| Weekly report | `claude-sonnet-4-6` | 15K / 3K |
| Activation message | **unchanged** — do not touch | — |

Monthly cost budget: **$30 steady-state, $50 alert threshold**.

---

## 4. Trigger strategy

**Single path: synchronous top-up inside Reactivation Engine.**

No async message-in worker. No separate cron for profile refresh.

Inside the Reactivation cron, after selecting the day's activation candidates:

```
for each candidate:
    # Step 1: refresh profile if needed
    if summary_updated_at IS NULL:
        run_profile_v1(customer_id)        # Sonnet
    elif new_messages_since(summary_updated_at) >= 3:
        run_profile_update(customer_id)    # Haiku
    elif profile_version >= 10 or age > 30 days:
        run_profile_v1(customer_id)        # forced full rebuild
    else:
        pass  # profile fresh enough

    # Step 2: safety gate — skip activation if unresolved return/exchange
    open_cases = [c for c in profile.intelligence.return_exchange_history.cases
                  if c.status in ("open", "disputed")]
    if open_cases:
        skip_activation(customer_id, reason="open_return_exchange", cases=open_cases)
        continue

    # Step 3: inject and activate as normal
    inject_profile_into_activation_context(customer_id)
```

Failure policy: profile generation failure **must not** block activation. Log the error, fall back to prior profile (or no profile), continue with current activation flow.

Safety gate outputs: skipped customers are written to a `skipped_activations` table (or logged to existing audit table) with reason code, so the weekly report can surface them.

---

## 5. Build-context integration

Modify the activation prompt builder to prepend a new section **before** existing context:

```
## Customer Profile

{narrative}

**Current state:** stage={state.current_stage}, open_objections={state.open_objections}, verification={state.verification_status}
**Outstanding from us:** {state.outstanding_asks_from_us}
**Outstanding from customer:** {state.outstanding_asks}
**Sample status:** {intelligence.sample_request_status}
**Return/exchange history:** {summary line — e.g. "1 resolved return (MR footbar, 2026-03)"}
**Recommended next move:** {intelligence.recommended_next_move}

---
```

Do not modify any other section of the existing prompt. The profile is additive only.

The sample status and return/exchange history lines are **omitted** (not shown as "none") when they carry no signal, to avoid noise in the prompt. Only shown when:
- `sample_request_status != "none"`
- `return_exchange_history.has_history == true`

---

## 6. Implementation phases

### Day 1 — Schema + Profile v1 generator

**Deliverables:**
- [ ] Verify `pipeline_state.conversation_summary` is JSONB (if TEXT, write migration and wait for Johnny approval before applying)
- [ ] Add the five btree expression indexes from §2 (via `migrations/` file)
- [ ] `src/profile/schema.py` — Pydantic model matching §2 schema (including `sample_request_status` and `return_exchange_history`)
- [ ] `src/profile/validator.py` — validate/repair function
- [ ] `prompts/profile_v1_full.md` — prompt for Sonnet full generation
- [ ] `src/profile/generator.py::generate_profile_v1(customer_id)` — fetches all messages, calls Sonnet, validates, writes to `conversation_summary` and stamps `summary_updated_at`
- [ ] `scripts/test_profile_v1.py` — run on 5 customers: Alex, Ari, Krim, Priscila, Ken
- [ ] Output 5 JSON profiles to `samples/profile_v1/` for manual review

**Pass gate (Johnny approves):**
At least 4 of 5 profiles must be "yes, this is how I see this customer." If not, tune the prompt only — do not advance to Day 2.

Specifically verify: sample request status and return/exchange history are captured correctly from message history on any customer where those events actually occurred.

### Day 2 — Incremental updater + activation integration

**Deliverables:**
- [ ] `prompts/profile_update.md` — prompt for Haiku incremental update
- [ ] `src/profile/generator.py::update_profile(customer_id, new_messages)` — takes prior profile + new messages, returns merged profile
- [ ] `scripts/test_profile_incremental.py` — on same 5 customers, compare incremental vs full. Key structured fields must match ≥90%.
- [ ] `src/build_context.py` — inject `## Customer Profile` section (see §5)
- [ ] Generate 5 pairs of activation messages (profile ON vs profile OFF) for Johnny's blind review

**Pass gate (Johnny approves):**
In blind comparison, profile-ON messages must feel clearly more customer-specific. If not, return to prompt tuning.

### Day 3 — Backfill + Reactivation integration

**Deliverables:**
- [ ] Backfill script for all customers where `current_stage IN ('quoted', 'needs_follow_up', 'engaging')`
- [ ] Rate limit: 10 customers/minute
- [ ] Integrate top-up logic into Reactivation Engine (see §4)
- [ ] Implement the return/exchange safety gate (see §4)
- [ ] Feature flag `PROFILE_SYSTEM_ENABLED=true/false` — one switch to disable and revert to pre-profile behavior

**Monitor for 1 week** before Day 3.5.

### Day 3.5 — Weekly report

**Deliverables:**
- [ ] SQL aggregation query: past 7 days stage transitions + current value_tier=A profiles + all open return/exchange cases + last week's skipped activations
- [ ] `prompts/weekly_report.md` — Sonnet prompt producing:
  - Top 3 opportunities (each with recommended next move)
  - Top 3 leakage risks (each with recommended next move)
  - **Open return/exchange cases needing attention (exhaustive list)**
  - **Skipped activations in the week (exhaustive list)**
  - 1 pattern observation
- [ ] Telegram push — Sunday 22:00 Beijing time
- [ ] Hard constraint in prompt: never output more than Top 3 per opportunity/risk category; return-case and skipped-activation sections are exhaustive; every action item must include concrete next step

---

## 7. Prompt design rules (for Sonnet/Haiku calls)

All profile-generation prompts must:

1. Explicitly require valid JSON output matching §2 schema — no markdown fences, no preamble
2. Enumerate allowed values for each enum field — reject free-text creativity in those slots
3. Force `intelligence.recommended_next_move` to be a concrete single-sentence action, not a generic "follow up"
4. `narrative` must be in Chinese (Johnny's working language)
5. Structured fields must use English enum values
6. Include one-shot example of a good profile in-prompt
7. Include instruction: "If evidence for a field is absent, use the 'unknown' / 'unclear' value — do not guess"
8. For `sample_request_status` and `return_exchange_history`: instruct AI to scan the entire message history for keywords (`sample`, `trial`, `样机`, `试用`, `return`, `exchange`, `refund`, `defect`, `damaged`, `退货`, `换货`, `退款`, `损坏`, `坏了`) and extract **factual events only** — never infer "probably returned"
9. For each `return_exchange_history.cases[]` entry, `date` must match a real message date in the provided history. If no source date can be found, do not include the case.

Validator must reject and re-request (once) if:
- JSON invalid
- Enum value outside allowed set
- Required field missing
- `return_exchange_history.cases[].status` or `type` contains any value outside the allowed set
- `return_exchange_history.cases[].date` is in the future or before the earliest message date

On second failure: log error, store the raw output in `extensions._failed_generation`, do not overwrite existing profile.

---

## 8. Testing

- [ ] `tests/test_profile_schema.py` — Pydantic round-trip, enum validation, required fields, nested `return_exchange_history` shape
- [ ] `tests/test_profile_validator.py` — rejection + repair paths (including future-dated case, invalid enum)
- [ ] `tests/test_profile_integration.py` — mocked AI response → written to DB → read back → matches
- [ ] Smoke test after Day 3 backfill: randomly pick 10 customers, verify profile exists, enum values valid, narrative non-empty
- [ ] **Safety gate test:** seed a test customer with an open return case, run Reactivation, verify customer is skipped and flagged in `skipped_activations`
- [ ] **Sample-status test:** seed a test customer with `sample_request_status = "shipped"`, verify activation prompt shows the sample line

---

## 9. Non-goals (explicitly OUT of scope)

Do NOT build any of the following during this phase:

- Async message-ingestion worker for real-time profile updates
- Profile version history / audit table (only latest version is stored)
- A/B testing framework for model or prompt variants
- Multilingual narrative (Chinese-only for now)
- Frontend / dashboard for profile viewing
- Webhook notifications on profile changes
- Customer-facing profile exposure
- Auto-reply drafting for return/exchange cases (profile only flags them; Johnny handles the reply)
- Automated sample-shipment tracking (only the status field is tracked; no integration with shipping APIs)

If any of these come up mid-implementation, stop and add to a "Phase 2" doc. Do not silently scope-creep.

---

## 10. Risk controls

| Risk | Control |
|---|---|
| Profile quality below bar → bad activations | Day 1 + Day 2 pass gates (Johnny review). Feature flag for instant rollback. |
| Incremental update drift over time | Forced full rebuild at `profile_version >= 10` or age > 30 days |
| Cost runaway | Monthly spend logged per customer; alert at $50/mo total |
| JSON output malformation | Validator + one repair retry + skip-on-fail |
| Weekly report alert fatigue | Hard Top-3 cap. If 2 consecutive reports feel low-signal, stop report — keep profiles |
| **AI hallucinates a return case** | Validator rejects any case without a source date in message history. Manual spot-check during Day 1 pass gate. |
| **AI misses an active return case** | Safety gate in §4 fails open (does not auto-activate unless clean). Weekly report section lists all open cases exhaustively. |
| **AI mis-tags sample status** | Keyword list in prompt §7.8; Day 1 pass gate requires spot-check on any customer with real sample activity |

---

## 11. Repository layout (expected)

```
src/profile/
  __init__.py
  schema.py          # Pydantic models
  validator.py       # JSON validation + repair
  generator.py       # generate_profile_v1, update_profile
  context_builder.py # inject into activation prompt

prompts/
  profile_v1_full.md
  profile_update.md
  weekly_report.md

scripts/
  test_profile_v1.py
  test_profile_incremental.py
  backfill_profiles.py

samples/profile_v1/
  alex.json
  ari.json
  krim.json
  priscila.json
  ken.json

tests/
  test_profile_schema.py
  test_profile_validator.py
  test_profile_integration.py

migrations/
  <timestamp>_customer_profile_indexes.sql

docs/
  customer_profile_system.md    # this file
```

---

## 12. Commit message convention

Per existing repo pattern (`docs/architecture_roadmap.md` commit style):

```
profile: <what>

<why, 1–2 lines>
<test evidence, 1 line>
```

Example:
```
profile: add v1 full generator with Sonnet

Generates initial structured profile from all customer messages.
Tested on 5 customers (Alex/Ari/Krim/Priscila/Ken), 5/5 pass Johnny review.
```
