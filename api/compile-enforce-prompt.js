const fs = require('fs');
const path = require('path');

function safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function safeBoolean(value) {
  if (value === true || value === 'true') return true;
  return false;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

function readSystemPrompt() {
  const promptPaths = [
    path.join(process.cwd(), 'prompts', 'enforce_quality_system.txt'),
    path.join(__dirname, '..', 'prompts', 'enforce_quality_system.txt')
  ];

  for (const promptPath of promptPaths) {
    try {
      if (fs.existsSync(promptPath)) {
        return fs.readFileSync(promptPath, 'utf8').trim();
      }
    } catch {
      // Try the next known path.
    }
  }

  return '';
}

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body || {};
}

function normalizeItems(body) {
  const normalizedBody = normalizeBody(body);
  const rawItems = Array.isArray(normalizedBody)
    ? normalizedBody
    : Array.isArray(normalizedBody.items)
      ? normalizedBody.items
      : [normalizedBody];

  return rawItems.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.json) {
      return item;
    }

    return {
      json: item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    };
  });
}

function getAllowedMicroTriggers(json) {
  const direct = json.allowed_micro_triggers;
  const payloadDecision = json.reactivation_ai_payload?.decision?.allowed_micro_triggers;
  const payloadStopPoint = json.reactivation_ai_payload?.stop_point?.allowed_micro_triggers;
  const forbiddenZone = json.forbidden_repeat_zone?.allowed_micro_triggers;

  if (Array.isArray(direct)) return direct;
  if (Array.isArray(payloadDecision)) return payloadDecision;
  if (Array.isArray(payloadStopPoint)) return payloadStopPoint;
  if (Array.isArray(forbiddenZone)) return forbiddenZone;
  return [];
}

function getAnchorObject(json) {
  return safeString(
    json.anchor_object ||
    json.reactivation_ai_payload?.decision?.anchor_object ||
    json.reactivation_ai_payload?.stop_point?.anchor_object ||
    json.reactivation_v6_core?.anchor_object ||
    json.primary_reply_anchor ||
    ''
  );
}

function buildFinalQualityUserPrompt(json) {
  const aiParsed = json.ai_parsed && typeof json.ai_parsed === 'object' ? json.ai_parsed : {};
  const candidateMessage = safeString(aiParsed.whatsapp_message || json._en || '');
  const allowedMicroTriggers = getAllowedMicroTriggers(json);
  const anchorObject = getAnchorObject(json);

  return [
    'Candidate message:',
    candidateMessage,
    '',
    'Project:',
    safeString(json.project_key),
    '',
    'Customer name:',
    safeString(json.customer_name),
    '',
    '--------------------------------',
    'SEND STATE',
    '--------------------------------',
    '',
    `- hard_no_send: ${safeBoolean(json.hard_no_send)}`,
    `- has_not_now_signal: ${safeBoolean(json.has_not_now_signal)}`,
    `- is_my_turn_to_reply: ${safeBoolean(json.is_my_turn_to_reply)}`,
    `- should_reactivate_now: ${safeBoolean(json.should_reactivate_now)}`,
    `- send_state: ${safeString(json.send_state)}`,
    `- status: ${safeString(json.status)}`,
    `- customer_last_message_type: ${safeString(json.customer_last_message_type)}`,
    `- reply_risk: ${safeString(json.reply_risk)}`,
    '',
    '--------------------------------',
    'PRIMARY EXECUTION FIELDS',
    '--------------------------------',
    '',
    'Parsed candidate:',
    safeString(aiParsed.whatsapp_message),
    '',
    'English candidate:',
    safeString(json._en),
    '',
    'Anchor object:',
    anchorObject,
    '',
    'Allowed micro-triggers:',
    safeJson(allowedMicroTriggers),
    '',
    'Needs enforce rewrite:',
    String(safeBoolean(json.needs_enforce_rewrite)),
    '',
    'Reactivation AI payload:',
    safeJson(json.reactivation_ai_payload || {}),
    '',
    '--------------------------------',
    'LAST STOP POINT',
    '--------------------------------',
    '',
    'Last customer message:',
    safeString(json.last_customer_message),
    '',
    'Last my message:',
    safeString(json.last_my_message),
    '',
    'Last exchange:',
    safeJson(json.last_exchange || {}),
    '',
    'Stop point analysis:',
    safeJson(json.stop_point_analysis || {}),
    '',
    'Forbidden repeat zone:',
    safeJson(json.forbidden_repeat_zone || {}),
    '',
    '--------------------------------',
    'KEY CONTEXT',
    '--------------------------------',
    '',
    'Primary reply anchor:',
    safeString(json.primary_reply_anchor),
    '',
    'Secondary context:',
    safeString(json.secondary_context),
    '',
    'Current blocker:',
    safeString(json.current_blocker),
    '',
    'Reply angle:',
    safeString(json.reply_angle),
    '',
    'Follow-up focus:',
    safeString(json.follow_up_focus),
    '',
    '--------------------------------',
    'REAL CONVERSATION',
    '--------------------------------',
    '',
    'Conversation core:',
    safeString(json.conversation_core),
    '',
    'Conversation:',
    safeString(json.conversation),
    '',
    '--------------------------------',
    'TASK',
    '--------------------------------',
    '',
    '1) If hard_no_send = true → return EMPTY.',
    '2) Validate the candidate message against the real conversation, customer context, and payload.',
    '3) If invalid but sendable → REWRITE using the strongest anchor from real history.',
    '4) The final message must be grounded in the real conversation and must not be generic.',
    '',
    '--------------------------------',
    'OUTPUT',
    '--------------------------------',
    '',
    'Return ONLY:',
    '',
    '{',
    '  "whatsapp_message": "FINAL MESSAGE OR EMPTY STRING"',
    '}'
  ].join('\n');
}

module.exports = async function (req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const finalQualitySystemPrompt = readSystemPrompt();
    const items = normalizeItems(req.body).map(item => {
      const json = item.json || {};

      return {
        json: {
          ...json,
          final_quality_system_prompt: finalQualitySystemPrompt,
          final_quality_user_prompt: buildFinalQualityUserPrompt(json)
        }
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'compile-enforce-prompt failed'
    });
  }
};
