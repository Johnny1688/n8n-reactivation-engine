function toSafeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeInputItems(body) {
  const rawItems = Array.isArray(body) ? body : [body || {}];

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
      json: item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    };
  });
}

function splitTelegramMessages(items) {
  const out = [];

  for (const item of items) {
    const data = item?.json || {};
    const messages = Array.isArray(data.telegram_messages) ? data.telegram_messages : [];

    if (messages.length < 3) continue;

    const msg1 = toSafeString(messages[0]);
    const msg2 = toSafeString(messages[1]);
    const msg3 = toSafeString(messages[2]);

    if (!msg1 || !msg2 || !msg3) continue;

    out.push({
      project_key: toSafeString(data.project_key),
      order_group: toSafeString(data.order_group),
      msg_1_full: msg1,
      msg_2_key: msg2,
      msg_3_en: msg3,
      whatsapp_message: toSafeString(data.whatsapp_message),
      whatsapp_message_cn: toSafeString(data.whatsapp_message_cn),
      analysis_text: toSafeString(data.analysis_text),
      enforce_status: toSafeString(data.enforce_status),
      auto_send_pass: !!data.auto_send_pass
    });
  }

  return out;
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
    const resultItems = splitTelegramMessages(inputItems);
    return res.status(200).json(resultItems);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'split-telegram-messages failed'
    });
  }
};
