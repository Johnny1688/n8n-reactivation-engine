function safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
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

function unwrapPromptValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');

  if (typeof value === 'object') {
    const nested = [
      value.quality_audit_system_prompt,
      value.quality_audit_user_prompt,
      value.system_prompt,
      value.user_prompt,
      value.body,
      value.data,
      value.text,
      value.content
    ];

    for (const candidate of nested) {
      const text = unwrapPromptValue(candidate);
      if (text.trim()) return text;
    }
  }

  return '';
}

function cleanPromptText(value) {
  return unwrapPromptValue(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function looksLikeUserPrompt(text) {
  const value = String(text || '');
  return (
    value.includes('{{$json.') ||
    value.includes('{{ JSON.stringify') ||
    value.includes('FINAL ACTIVATION MESSAGE') ||
    value.includes('Audit this customer now')
  );
}

function looksLikeSystemPrompt(text) {
  const value = String(text || '');
  return (
    value.includes('quality-audit system') ||
    value.includes('STRICT JSON OUTPUT') ||
    value.includes('"analysis_quality_score"') ||
    value.includes('You are a WhatsApp Reactivation quality-audit system')
  );
}

function pickPromptFromFields(json, preferredFields, fallbackFields, expectedKind) {
  for (const field of preferredFields) {
    const text = cleanPromptText(json[field]);
    if (text) return text;
  }

  const fallbacks = fallbackFields
    .map(field => cleanPromptText(json[field]))
    .filter(Boolean);

  const matcher = expectedKind === 'user' ? looksLikeUserPrompt : looksLikeSystemPrompt;
  const matched = fallbacks.find(matcher);
  if (matched) return matched;

  const oppositeMatcher = expectedKind === 'user' ? looksLikeSystemPrompt : looksLikeUserPrompt;
  const notOpposite = fallbacks.find(text => !oppositeMatcher(text));
  if (notOpposite) return notOpposite;

  return fallbacks[0] || '';
}

function resolvePromptText(json, kind) {
  if (kind === 'system') {
    return pickPromptFromFields(
      json,
      ['quality_audit_system_prompt', 'system_prompt'],
      ['body', 'data', 'text'],
      'system'
    );
  }

  return pickPromptFromFields(
    json,
    ['quality_audit_user_prompt', 'user_prompt'],
    ['body', 'data', 'text'],
    'user'
  );
}

function renderValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function evaluateTemplateExpression(expression, json) {
  const expr = String(expression || '').trim();
  if (!expr) return '';

  try {
    // The prompt templates are repository-controlled n8n-style expressions.
    // Keep the evaluation scope narrow and fail closed to an empty string.
    const fn = new Function('$json', 'JSON', `"use strict"; return (${expr});`);
    return renderValue(fn(json || {}, JSON));
  } catch {
    return '';
  }
}

function renderN8nTemplate(template, json) {
  const text = safeString(template);
  if (!text) return '';

  return text.replace(/{{\s*([\s\S]*?)\s*}}/g, (_, expression) => (
    evaluateTemplateExpression(expression, json)
  ));
}

function compileActivationQualityAuditPromptItems(items) {
  return items.map(item => {
    const json = item.json || {};
    const systemPrompt = resolvePromptText(json, 'system');
    const userPromptTemplate = resolvePromptText(json, 'user');

    return {
      json: {
        ...json,
        final_quality_audit_system_prompt: cleanPromptText(systemPrompt),
        final_quality_audit_user_prompt: renderN8nTemplate(userPromptTemplate, json).trim()
      }
    };
  });
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
    const resultItems = compileActivationQualityAuditPromptItems(items);
    return res.status(200).json({ items: resultItems });
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'compile-activation-quality-audit-prompt failed'
    });
  }
}

handler.normalizeItems = normalizeItems;
handler.renderN8nTemplate = renderN8nTemplate;
handler.compileActivationQualityAuditPromptItems = compileActivationQualityAuditPromptItems;

module.exports = handler;
