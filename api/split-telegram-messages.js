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
    const projectKey = toSafeString(data.project_key);
    const orderGroup = toSafeString(data.order_group);
    const messages = Array.isArray(data.telegram_messages) ? data.telegram_messages : [];

    for (let i = 0; i < messages.length; i++) {
      const text = toSafeString(messages[i]);
      if (!text) continue;

      out.push({
        project_key: projectKey,
        order_group: orderGroup,
        text,
        _delay_before_ms: out.length * 1000
      });
    }
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
