// profile_validator.js
// Purpose: validate AI-generated customer profile JSON before writing to DB.
// Usage in n8n Code node: paste this entire file, then call:
//   const { valid, profile, errors } = validateProfile($json.ai_output);
//
// SCHEMA COPY — sync manually from schemas/customer_profile.schema.json
// when schema changes. Last synced: 2026-04-20 (schema v1).

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CustomerProfile",
  "description": "Matches docs/customer_profile_system.md §2 (v1.2). Any schema change must update docs first, then this file, then nodes/profile_validator.js embedded copy.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "profile_version",
    "generated_at",
    "generation_mode",
    "source_message_count",
    "identity",
    "commercial",
    "timeline",
    "state",
    "intelligence",
    "narrative"
  ],
  "properties": {
    "schema_version": { "const": 1 },
    "profile_version": { "type": "integer", "minimum": 1 },
    "generated_at": { "type": "string", "format": "date-time" },
    "generation_mode": { "type": "string", "enum": ["full", "incremental"] },
    "source_message_count": { "type": "integer", "minimum": 0 },

    "identity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "customer_type", "country", "region", "business_stage",
        "decision_role", "language_preference"
      ],
      "properties": {
        "customer_type": {
          "type": "string",
          "enum": ["studio_owner", "distributor", "ecommerce", "reseller", "unclear"]
        },
        "country": { "type": "string" },
        "region": { "type": "string" },
        "business_stage": {
          "type": "string",
          "enum": ["launching", "expanding", "replacing", "exploring", "unknown"]
        },
        "decision_role": {
          "type": "string",
          "enum": ["owner", "buyer", "influencer", "unclear"]
        },
        "language_preference": { "type": "string", "minLength": 2, "maxLength": 2 }
      }
    },

    "commercial": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "budget_tier", "volume_signal", "target_models", "material_preference",
        "style_preference", "shipping_term", "pricing_sent", "last_quote_ref",
        "competitors_mentioned"
      ],
      "properties": {
        "budget_tier": {
          "type": "string",
          "enum": ["low", "mid", "high", "unknown"]
        },
        "volume_signal": {
          "type": "string",
          "enum": ["1-9", "10-29", "30-99", "100+", "unknown"]
        },
        "target_models": { "type": "array", "items": { "type": "string" }, "default": [] },
        "material_preference": {
          "type": "string",
          "enum": ["aluminum", "wood", "stainless", "mixed", "undecided"]
        },
        "style_preference": { "type": "array", "items": { "type": "string" }, "default": [] },
        "shipping_term": {
          "type": "string",
          "enum": ["FOB", "CIF", "DDP", "EXW", "unknown"]
        },
        "pricing_sent": { "type": "boolean" },
        "last_quote_ref": { "type": "string" },
        "competitors_mentioned": { "type": "array", "items": { "type": "string" }, "default": [] }
      }
    },

    "timeline": {
      "type": "object",
      "additionalProperties": false,
      "required": ["decision_horizon", "urgency_signals"],
      "properties": {
        "decision_horizon": {
          "type": "string",
          "enum": ["immediate", "1-3mo", "3-6mo", "6mo+", "unclear"]
        },
        "urgency_signals": { "type": "array", "items": { "type": "string" }, "default": [] },
        "last_inbound_at": { "type": ["string", "null"], "format": "date-time" },
        "last_outbound_at": { "type": ["string", "null"], "format": "date-time" }
      }
    },

    "state": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "current_stage", "open_objections", "verification_status",
        "outstanding_asks", "outstanding_asks_from_us"
      ],
      "properties": {
        "current_stage": { "type": "string" },
        "open_objections": { "type": "array", "items": { "type": "string" }, "default": [] },
        "verification_status": {
          "type": "string",
          "enum": ["none", "requested", "video_offered_pending", "evidence_sent", "satisfied"]
        },
        "outstanding_asks": { "type": "array", "items": { "type": "string" }, "default": [] },
        "outstanding_asks_from_us": { "type": "array", "items": { "type": "string" }, "default": [] }
      }
    },

    "intelligence": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "value_tier", "win_probability", "key_risks", "leverage_points",
        "recommended_next_move", "sample_request_status", "return_exchange_history"
      ],
      "properties": {
        "value_tier": { "type": "string", "enum": ["A", "B", "C"] },
        "win_probability": { "type": "number", "minimum": 0, "maximum": 1 },
        "key_risks": { "type": "array", "items": { "type": "string" }, "default": [] },
        "leverage_points": { "type": "array", "items": { "type": "string" }, "default": [] },
        "recommended_next_move": { "type": "string" },
        "sample_request_status": {
          "type": "string",
          "enum": ["none", "inquired", "quoted", "paid", "shipped", "received", "declined"]
        },
        "return_exchange_history": {
          "type": "object",
          "additionalProperties": false,
          "required": ["has_history", "cases"],
          "properties": {
            "has_history": { "type": "boolean" },
            "cases": {
              "type": "array",
              "default": [],
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["date", "type", "item", "reason", "resolution", "status"],
                "properties": {
                  "date": { "type": "string", "format": "date" },
                  "type": {
                    "type": "string",
                    "enum": ["return", "exchange", "partial_refund", "warranty_claim"]
                  },
                  "item": { "type": "string" },
                  "reason": { "type": "string" },
                  "resolution": { "type": "string" },
                  "status": {
                    "type": "string",
                    "enum": ["open", "resolved", "disputed", "abandoned"]
                  }
                }
              }
            }
          }
        }
      }
    },

    "narrative": { "type": "string" },

    "key_quotes": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["date", "quote"],
        "properties": {
          "date": { "type": "string", "format": "date" },
          "quote": { "type": "string" }
        }
      }
    },

    "extensions": {
      "type": "object",
      "additionalProperties": true,
      "default": {}
    }
  }
};

// ---------------------------------------------------------------------------
// Schema validator (Ajv)
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const _validate = ajv.compile(SCHEMA);

// ---------------------------------------------------------------------------
// Business-rule checks (spec §7, beyond JSON Schema)
// ---------------------------------------------------------------------------

function validateBusinessRules(profile) {
  const errors = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // (a) return_exchange_history case dates must not be in the future
  const cases = profile.intelligence &&
    profile.intelligence.return_exchange_history &&
    profile.intelligence.return_exchange_history.cases;
  if (Array.isArray(cases)) {
    cases.forEach((c, i) => {
      if (c.date && c.date > today) {
        errors.push(
          `intelligence.return_exchange_history.cases[${i}].date ` +
          `"${c.date}" is in the future (today: ${today})`
        );
      }
    });
  }

  // (b) profile_version >= 1  (schema already enforces, double-check)
  if (typeof profile.profile_version === 'number' && profile.profile_version < 1) {
    errors.push(`profile_version must be >= 1, got ${profile.profile_version}`);
  }

  // (c) every case must have a date  (schema required, double-check)
  if (Array.isArray(cases)) {
    cases.forEach((c, i) => {
      if (!c.date) {
        errors.push(
          `intelligence.return_exchange_history.cases[${i}] missing date`
        );
      }
    });
  }

  // TODO: date must correspond to a real message date in the conversation
  //       history. Requires message data not available at validation time.

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function validateProfile(raw) {
  // 1. Parse if string
  let obj;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return { valid: false, profile: null, errors: [`Invalid JSON: ${e.message}`] };
    }
  } else {
    obj = raw;
  }

  // 2. Schema validation
  const schemaValid = _validate(obj);
  if (!schemaValid) {
    const errors = (_validate.errors || []).map((err) => {
      const path = err.instancePath || '';
      const msg = err.message || 'unknown error';
      if (err.keyword === 'enum') {
        return `${path} ${msg}. Allowed: ${JSON.stringify(err.params.allowedValues)}`;
      }
      if (err.keyword === 'additionalProperties') {
        return `${path} has unexpected property "${err.params.additionalProperty}"`;
      }
      return `${path} ${msg}`;
    });
    return { valid: false, profile: null, errors };
  }

  // 3. Business-rule checks
  const bizErrors = validateBusinessRules(obj);
  if (bizErrors.length > 0) {
    return { valid: false, profile: null, errors: bizErrors };
  }

  // 4. All passed
  return { valid: true, profile: obj, errors: null };
}

// ---------------------------------------------------------------------------
// Export for both require() and n8n Code node global scope
// ---------------------------------------------------------------------------

module.exports = { validateProfile, validateBusinessRules };

if (typeof globalThis !== 'undefined') {
  globalThis.validateProfile = validateProfile;
  globalThis.validateBusinessRules = validateBusinessRules;
}
