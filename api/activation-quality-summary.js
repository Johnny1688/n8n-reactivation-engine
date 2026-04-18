const SCORE_FIELDS = [
  'analysis_quality_score',
  'stop_point_quality_score',
  'blocker_quality_score',
  'anchor_quality_score',
  'activation_message_quality_score',
  'grounding_quality_score',
  'personalization_quality_score',
  'low_friction_quality_score'
];

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
      return {
        ...item,
        json: {
          ...item.json,
          output: item.json.output || item.output
        }
      };
    }

    return {
      json: item && typeof item === 'object' && !Array.isArray(item)
        ? {
            ...item,
            output: item.output
          }
        : {}
    };
  });
}

function safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function stripCodeFence(text) {
  return safeString(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractFirstJsonObject(text) {
  const raw = stripCodeFence(text);
  if (!raw) return '';

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return raw;
  return raw.slice(first, last + 1);
}

function parseJsonSafe(raw) {
  const text = extractFirstJsonObject(raw);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getAuditText(json) {
  return safeString(
    json?.output?.[0]?.content?.[0]?.text ||
    json?.content?.[0]?.text ||
    json?.output?.[0]?.content?.text ||
    json?.output_text ||
    json?.text ||
    json?.body ||
    ''
  );
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toBoolean(value) {
  return value === true || value === 'true';
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function average(sum, count) {
  return count > 0 ? round2(sum / count) : 0;
}

function buildWeakCase(audit) {
  return {
    project_key: safeString(audit.project_key),
    customer_name: safeString(audit.customer_name),
    analysis_quality_score: toNumber(audit.analysis_quality_score),
    activation_message_quality_score: toNumber(audit.activation_message_quality_score),
    top_problem_1: safeString(audit.top_problem_1),
    top_problem_2: safeString(audit.top_problem_2),
    final_verdict: safeString(audit.final_verdict)
  };
}

function isWeakCase(audit) {
  return (
    toNumber(audit.analysis_quality_score) < 7 ||
    toNumber(audit.activation_message_quality_score) < 7 ||
    toBoolean(audit.wrong_name_risk) ||
    toBoolean(audit.generic_risk)
  );
}

function scoreForWorstCase(audit) {
  const scores = [
    toNumber(audit.analysis_quality_score),
    toNumber(audit.stop_point_quality_score),
    toNumber(audit.blocker_quality_score),
    toNumber(audit.anchor_quality_score),
    toNumber(audit.activation_message_quality_score),
    toNumber(audit.grounding_quality_score),
    toNumber(audit.personalization_quality_score),
    toNumber(audit.low_friction_quality_score)
  ];

  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const riskPenalty = [
    audit.wrong_name_risk,
    audit.generic_risk,
    audit.reusable_risk,
    audit.vague_object_risk
  ].filter(toBoolean).length * 2;

  return avg - riskPenalty;
}

function summarizeActivationQuality(items) {
  const summary = {
    total_customers: items.length,
    parsed_success_count: 0,
    parsed_error_count: 0,
    avg_analysis_quality_score: 0,
    avg_stop_point_quality_score: 0,
    avg_blocker_quality_score: 0,
    avg_anchor_quality_score: 0,
    avg_activation_message_quality_score: 0,
    avg_grounding_quality_score: 0,
    avg_personalization_quality_score: 0,
    avg_low_friction_quality_score: 0,
    missing_name_count: 0,
    wrong_name_count: 0,
    generic_risk_count: 0,
    reusable_risk_count: 0,
    vague_object_count: 0,
    weak_anchor_count: 0,
    not_now_handling_bad_count: 0,
    weak_cases: [],
    top_problem_projects: []
  };

  const sums = SCORE_FIELDS.reduce((acc, field) => {
    acc[field] = 0;
    return acc;
  }, {});

  const parsedAudits = [];

  for (const item of items) {
    const json = item.json || {};
    const audit = parseJsonSafe(getAuditText(json));

    if (!audit) {
      summary.parsed_error_count += 1;
      continue;
    }

    summary.parsed_success_count += 1;
    parsedAudits.push(audit);

    for (const field of SCORE_FIELDS) {
      sums[field] += toNumber(audit[field]);
    }

    if (!toBoolean(audit.name_present)) summary.missing_name_count += 1;
    if (toBoolean(audit.wrong_name_risk) || audit.correct_name_binding === false) {
      summary.wrong_name_count += 1;
    }
    if (toBoolean(audit.generic_risk)) summary.generic_risk_count += 1;
    if (toBoolean(audit.reusable_risk)) summary.reusable_risk_count += 1;
    if (toBoolean(audit.vague_object_risk)) summary.vague_object_count += 1;
    if (toNumber(audit.anchor_quality_score) < 7) summary.weak_anchor_count += 1;
    if (audit.not_now_handling_ok === false || audit.not_now_handling_ok === 'false') {
      summary.not_now_handling_bad_count += 1;
    }

    if (isWeakCase(audit)) {
      summary.weak_cases.push(buildWeakCase(audit));
    }
  }

  const count = summary.parsed_success_count;
  summary.avg_analysis_quality_score = average(sums.analysis_quality_score, count);
  summary.avg_stop_point_quality_score = average(sums.stop_point_quality_score, count);
  summary.avg_blocker_quality_score = average(sums.blocker_quality_score, count);
  summary.avg_anchor_quality_score = average(sums.anchor_quality_score, count);
  summary.avg_activation_message_quality_score = average(sums.activation_message_quality_score, count);
  summary.avg_grounding_quality_score = average(sums.grounding_quality_score, count);
  summary.avg_personalization_quality_score = average(sums.personalization_quality_score, count);
  summary.avg_low_friction_quality_score = average(sums.low_friction_quality_score, count);

  summary.top_problem_projects = parsedAudits
    .slice()
    .sort((a, b) => scoreForWorstCase(a) - scoreForWorstCase(b))
    .slice(0, 10)
    .map(audit => ({
      project_key: safeString(audit.project_key),
      customer_name: safeString(audit.customer_name),
      final_verdict: safeString(audit.final_verdict),
      analysis_quality_score: toNumber(audit.analysis_quality_score),
      activation_message_quality_score: toNumber(audit.activation_message_quality_score),
      anchor_quality_score: toNumber(audit.anchor_quality_score),
      top_problem_1: safeString(audit.top_problem_1),
      top_problem_2: safeString(audit.top_problem_2)
    }));

  return summary;
}

async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const items = normalizeItems(req.body);
    const summary = summarizeActivationQuality(items);
    return res.status(200).json({ items: [{ json: summary }] });
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'activation-quality-summary failed'
    });
  }
}

handler.normalizeItems = normalizeItems;
handler.parseJsonSafe = parseJsonSafe;
handler.summarizeActivationQuality = summarizeActivationQuality;

module.exports = handler;
