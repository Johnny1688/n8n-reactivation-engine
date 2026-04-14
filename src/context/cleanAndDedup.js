function cleanText(text) {
  if (!text) return '';

  return String(text)
    .replace(/media-cancel/gi, '')
    .replace(/ic-videocam\d*:\d+/gi, '')
    .replace(/instagram广告\s*查看详情/gi, '')
    .replace(/instagram\s*广告查看详情/gi, '')
    .replace(/instagram\s*广告/gi, '')
    .replace(/自动问候消息/gi, '')
    .replace(/(\D)\d{1,2}:\d{2}\b/g, '$1')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[!！]{2,}/g, '!')
    .replace(/[?？]{2,}/g, '?')
    .replace(/[.。]{3,}/g, '...')
    .trim();
}

function stripTrailingTimeArtifacts(text) {
  if (!text) return '';
  return String(text)
    .replace(/([a-zA-Z])\d{1,2}:\d{2}\b/g, '$1')
    .replace(/\s+\d{1,2}:\d{2}\b/g, '')
    .trim();
}

function stripChinese(text) {
  if (!text) return '';
  return String(text).replace(/[\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripEnglish(text) {
  if (!text) return '';
  return String(text).replace(/[A-Za-z0-9.,!?;:'"()/%&+\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function baseSemanticForm(text) {
  const cleaned = cleanText(stripTrailingTimeArtifacts(text || ''));
  const noChinese = stripChinese(cleaned);
  return noChinese
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForDedup(text) {
  return cleanText(stripTrailingTimeArtifacts(text || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactForSimilarity(text) {
  return normalizeForDedup(text)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMessageQuality(text) {
  const t = cleanText(text || '');
  let score = t.length;

  if (/[A-Za-z]/.test(t) && /[一-龥]/.test(t)) score += 8;
  if (/\n/.test(t)) score += 4;
  if (/^https?:\/\//i.test(t)) score -= 12;
  if (/^(ok|okay|thanks|thank you|ah ok|got it)$/i.test(t)) score -= 8;

  return score;
}

function stripQuotedPrefix(message, previousMyMessage = '') {
  const msg = cleanText(message);
  const prev = cleanText(previousMyMessage);

  if (!msg || !prev) return msg;

  const compactMsg = compactForSimilarity(msg);
  const compactPrev = compactForSimilarity(prev);

  if (
    compactPrev.length >= 20 &&
    compactMsg.startsWith(compactPrev.slice(0, Math.min(60, compactPrev.length)))
  ) {
    const rawIndex = msg.toLowerCase().indexOf(prev.toLowerCase().slice(0, 30));
    if (rawIndex === 0) {
      const stripped = msg.slice(prev.length).trim();
      return stripped || msg;
    }
  }

  return msg;
}

function isNearDuplicate(a, b) {
  const aa = compactForSimilarity(a);
  const bb = compactForSimilarity(b);

  if (!aa || !bb) return false;
  if (aa === bb) return true;

  const aBase = baseSemanticForm(a);
  const bBase = baseSemanticForm(b);

  if (aBase && bBase && aBase === bBase) return true;

  if (aBase.length >= 10 && bBase.includes(aBase)) return true;
  if (bBase.length >= 10 && aBase.includes(bBase)) return true;

  if (aa.length >= 10 && bb.includes(aa)) return true;
  if (bb.length >= 10 && aa.includes(bb)) return true;

  const ap = aa.slice(0, 28);
  const bp = bb.slice(0, 28);
  if (ap && bp && ap === bp) return true;

  return false;
}

function normalizeUnknown(v) {
  if (v == null) return '';
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'undefined' || s === 'null') return '';
  return String(v).trim();
}

function uniqueNonEmpty(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function cleanAndDedup(input) {
  // =========================
  // 1) 原始消息
  // =========================
  const parsedMessages = Array.isArray(input.messages) ? input.messages : [];

  // =========================
  // 4) 清洗消息
  // =========================
  const cleanedMessages = parsedMessages
    .map((m, idx, arr) => {
      const role = m.role || '';
      const previousMe =
        role === 'customer'
          ? [...arr.slice(0, idx)].reverse().find(x => (x.role || '') === 'me')?.message || ''
          : '';

      const cleanedMessage = cleanText(stripTrailingTimeArtifacts(m.message || ''));
      const finalMessage =
        role === 'customer'
          ? stripQuotedPrefix(cleanedMessage, previousMe)
          : cleanedMessage;

      return {
        ...m,
        role,
        message: finalMessage,
        message_time: m.message_time || ''
      };
    })
    .filter(m => m.message);

  // =========================
  // 5) 完全重复去重
  // =========================
  const exactSeen = new Set();
  const exactUnique = cleanedMessages.filter(m => {
    const key = `${m.role}__${normalizeForDedup(m.message)}__${baseSemanticForm(m.message)}`;
    if (exactSeen.has(key)) return false;
    exactSeen.add(key);
    return true;
  });

  // =========================
  // 6) 近重复压缩
  // =========================
  const grouped = [];

  for (const m of exactUnique) {
    let merged = false;

    for (let i = 0; i < grouped.length; i++) {
      const existing = grouped[i];

      const sameRole = existing.role === m.role;
      const sameTime = (existing.message_time || '') === (m.message_time || '');
      const similar = isNearDuplicate(existing.message, m.message);

      if (sameRole && sameTime && similar) {
        const existingScore = scoreMessageQuality(existing.message);
        const currentScore = scoreMessageQuality(m.message);

        if (currentScore > existingScore) {
          grouped[i] = m;
        }
        merged = true;
        break;
      }
    }

    if (!merged) grouped.push(m);
  }

  const uniqueMessages = grouped.sort((a, b) => {
    const ta = a.message_time ? new Date(a.message_time).getTime() : 0;
    const tb = b.message_time ? new Date(b.message_time).getTime() : 0;
    return ta - tb;
  });

  return {
    parsedMessages,
    cleanedMessages,
    exactUnique,
    uniqueMessages
  };
}

module.exports = {
  cleanAndDedup,
  cleanText,
  stripTrailingTimeArtifacts,
  stripChinese,
  stripEnglish,
  baseSemanticForm,
  normalizeForDedup,
  compactForSimilarity,
  scoreMessageQuality,
  stripQuotedPrefix,
  isNearDuplicate,
  normalizeUnknown,
  uniqueNonEmpty
};
