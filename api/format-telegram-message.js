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

function normalizeMessageValue(value) {
  const cleaned = cleanupMessage(value);
  const lower = cleaned.toLowerCase();

  if (!cleaned) return '';
  if (lower === 'undefined') return '';
  if (lower === 'null') return '';

  return cleaned;
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

function normalizeText(value) {
  return cleanupMessage(value).toLowerCase();
}

function isWeakCandidateMessage(message) {
  const text = normalizeText(message);
  if (!text) return false;

  const weakPatterns = [
    'are you still considering',
    'would you like to confirm',
    'just let me know',
    'ready to chat again',
    'are you okay with',
    'know how our prices compare',
    'confirm the price details',
    'would you like to know how our prices compare',
    'would you like to know',
    'are you ready',
    'still interested',
    'any update',
    'following up',
    'checking in',
    'just checking'
  ];

  return weakPatterns.some(pattern => text.includes(pattern));
}

function buildChineseGloss(message) {
  const text = cleanupMessage(message);
  const lower = text.toLowerCase();

  if (!text) return '';

  if (/price|pricing|quote|cost/.test(lower)) {
    if (/resend|send/.test(lower)) return '我可以把之前的价格整理成一条清楚的信息发给你，要我发这里吗？';
    if (/line|lay|put|break|compare|difference/.test(lower)) return '我可以把价格范围整理清楚发给你，要我发这里吗？';
    return '我可以把价格信息简单整理一下，要我发这里吗？';
  }

  if (/catalog|pdf/.test(lower)) {
    return '我可以把目录链接重新发一遍，要我发这里吗？';
  }

  if (/photo|photos|video|videos|picture|pictures/.test(lower)) {
    return '我可以把图片/视频整理成一条信息发给你，要我发这里吗？';
  }

  if (/shipping|ship|delivery|zip|houston/.test(lower)) {
    return '我可以把运输信息整理成一条清楚的信息，要我发这里吗？';
  }

  if (/warranty/.test(lower)) {
    return '我可以把质保信息简单整理一下，要我发这里吗？';
  }

  if (/deposit|payment/.test(lower)) {
    return '我可以把付款信息简单整理一下，要我发这里吗？';
  }

  if (/cheaper|supplier|compare|comparison|difference/.test(lower)) {
    return '我可以把关键差异整理成一条简单信息，要我发这里吗？';
  }

  if (/ar010|ar011|ar012|model|models|reformer|setup|option|shortlist/.test(lower)) {
    return '我可以把相关选项整理成一条简单信息，要我发这里吗？';
  }

  if (/send it|send that|want me to/.test(lower)) {
    return '我可以整理成一条简单信息发给你，要我发这里吗？';
  }

  return '';
}

function getNestedOutputText(source) {
  return firstNonEmptyString(
    source?.output?.[0]?.content?.[0]?.text,
    source?.content?.[0]?.text,
    source?.output_text,
    source?.text,
    source?.message
  );
}

function normalizeAiParsed(data, item) {
  const existingParsed = parseJsonSafe(data.ai_parsed);
  const rawAiText = firstNonEmptyString(
    getNestedOutputText(data),
    getNestedOutputText(item)
  );
  const outputParsed = parseJsonSafe(rawAiText);

  const aiParsed = {
    ...outputParsed,
    ...existingParsed
  };

  const whatsappMessage = normalizeMessageValue(
    firstNonEmptyString(
      aiParsed.whatsapp_message,
      aiParsed.whatsapp_text,
      aiParsed.final_message,
      aiParsed.whatsapp_message_en,
      aiParsed.message_text,
      data.whatsapp_message,
      data.whatsapp_text,
      data.final_message,
      data.message_text
    )
  );

  return {
    ...aiParsed,
    whatsapp_message: whatsappMessage
  };
}

function normalizeInputItems(body) {
  const rawItems = Array.isArray(body) ? body : [body || {}];

  return rawItems.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.json) {
      return {
        ...item,
        json: {
          ...item.json,
          output: item.json.output || item.output,
          output_text: item.json.output_text || item.output_text,
          text: item.json.text || item.text,
          message: item.json.message || item.message
        }
      };
    }

    return {
      json: item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    };
  });
}

function formatTelegramMessageItems(items) {
  return items
    .map(item => {
      const data = item.json || {};
      const aiParsed = normalizeAiParsed(data, item);
      const en = normalizeMessageValue(aiParsed.whatsapp_message);

      const projectKey = firstNonEmptyString(
        data.project_key,
        aiParsed.project_key
      );

      const orderGroup = firstNonEmptyString(
        data.order_group,
        projectKey,
        aiParsed.order_group
      );

      const cn = en
        ? firstNonEmptyString(
            data.whatsapp_message_cn,
            data.whatsapp_text_cn,
            data.message_cn,
            aiParsed.whatsapp_message_cn,
            aiParsed.whatsapp_text_cn,
            aiParsed.message_cn
          )
        : '';

      const needsEnforceRewrite = en ? isWeakCandidateMessage(en) : false;

      return {
        json: {
          ...data,
          ai_parsed: aiParsed,
          order_group: orderGroup,
          project_key: projectKey,
          _en: en,
          _cn: cn,
          weak_candidate_message: needsEnforceRewrite ? en : '',
          needs_enforce_rewrite: needsEnforceRewrite
        }
      };
    })
    .filter(item => {
      const data = item.json || {};

      const projectKey = cleanupMessage(data.project_key);
      const orderGroup = cleanupMessage(data.order_group);

      if (!projectKey) return false;
      if (!orderGroup) return false;

      return true;
    })
    .map(item => {
      const data = item.json || {};

      const projectKey = cleanupMessage(data.project_key);
      const orderGroup = cleanupMessage(data.order_group);
      const en = normalizeMessageValue(data._en);
      const cn = en ? cleanupMessage(data._cn) || buildChineseGloss(en) : '';
      const telegramMessages = en
        ? [
            `【${projectKey}】

English:
${en}

中文翻译:
${cn || '（AI未输出中文翻译）'}`,
            en
          ]
        : [];

      return {
        json: {
          ...data,
          order_group: orderGroup,
          project_key: projectKey,
          ai_parsed: {
            ...(data.ai_parsed || {}),
            whatsapp_message: en
          },
          _en: en,
          _cn: cn,
          weak_candidate_message: en ? data.weak_candidate_message || '' : '',
          needs_enforce_rewrite: en ? data.needs_enforce_rewrite === true : false,
          telegram_messages: telegramMessages
        }
      };
    });
}

module.exports = async function (req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const inputItems = normalizeInputItems(req.body);
    const resultItems = formatTelegramMessageItems(inputItems);
    return res.status(200).json(resultItems);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'format-telegram-message failed'
    });
  }
};
