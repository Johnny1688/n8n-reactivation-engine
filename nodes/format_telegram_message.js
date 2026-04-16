function toSafeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function cleanupMessage(value) {
  return toSafeString(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const cleaned = cleanupMessage(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function parseJsonSafe(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;

  const text = toSafeString(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

return items
  .map(item => {
    const data = item.json || {};

    let aiParsed = {};

    if (data.ai_parsed) {
      aiParsed = parseJsonSafe(data.ai_parsed);
    } else if (data.output?.[0]?.content?.[0]?.text) {
      aiParsed = parseJsonSafe(data.output[0].content[0].text);
    } else if (data.output_text) {
      aiParsed = parseJsonSafe(data.output_text);
    } else if (data.text) {
      aiParsed = parseJsonSafe(data.text);
    } else if (data.message) {
      aiParsed = parseJsonSafe(data.message);
    }

    const projectKey = firstNonEmptyString(
      data.project_key,
      aiParsed.project_key
    );

    const orderGroup = firstNonEmptyString(
      data.order_group,
      projectKey,
      aiParsed.order_group
    );

    const en = firstNonEmptyString(
      data.whatsapp_text,
      data.whatsapp_message,
      data.final_message,
      data.message_text,
      aiParsed.whatsapp_text,
      aiParsed.whatsapp_message,
      aiParsed.final_message,
      aiParsed.whatsapp_message_en,
      aiParsed.message_text
    );

    const cn = firstNonEmptyString(
      data.whatsapp_message_cn,
      data.whatsapp_text_cn,
      data.message_cn,
      aiParsed.whatsapp_message_cn,
      aiParsed.whatsapp_text_cn,
      aiParsed.message_cn
    );

    return {
      json: {
        ...data,
        ai_parsed: aiParsed,
        order_group: orderGroup,
        project_key: projectKey,
        _en: en,
        _cn: cn
      }
    };
  })
  .filter(item => {
    const data = item.json || {};
    const projectKey = cleanupMessage(data.project_key);
    if (!projectKey) return false;
    return true;
  })
  .map(item => {
    const data = item.json || {};
    const en = cleanupMessage(data._en);
    const enLower = en.toLowerCase();
    const isWeakCandidate = !en || en.length < 10 || enLower === 'undefined' || enLower === 'null';

    if (isWeakCandidate) {
      return {
        json: {
          ...data,
          _en: '[GENERATOR_RETURNED_EMPTY_NEEDS_FALLBACK]',
          weak_candidate_message: '',
          needs_enforce_rewrite: true
        }
      };
    }

    return item;
  })
  .map(item => {
    const data = item.json || {};

    if (data.needs_enforce_rewrite === true) {
      return item;
    }

    const projectKey = cleanupMessage(data.project_key);
    const orderGroup = cleanupMessage(data.order_group);
    const en = cleanupMessage(data._en);
    const cn = cleanupMessage(data._cn);

    return {
      json: {
        ...data,
        order_group: orderGroup,
        project_key: projectKey,
        ai_parsed: data.ai_parsed || {},
        _en: en,
        _cn: cn,
        telegram_messages: [
          `【${projectKey}】

English:
${en}

中文翻译:
${cn || '（AI未输出中文翻译）'}`,
          en
        ]
      }
    };
  });
