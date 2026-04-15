function toSafeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeInputItems(body) {
  const rawItems = Array.isArray(body) ? body : [body || {}];

  return rawItems.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.json) {
      return item;
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

    for (const message of messages) {
      const text = toSafeString(message);
      if (!text) continue;

      out.push({
        json: {
          project_key: projectKey,
          order_group: orderGroup,
          text
        }
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
