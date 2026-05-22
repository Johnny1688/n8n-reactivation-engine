function parseJsonSafe(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(
      raw
        .replace(/^```json/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim()
    );
  } catch {
    return {};
  }
}

function has(v) {
  return (
    v !== undefined &&
    v !== null &&
    String(v).trim() !== '' &&
    String(v).toLowerCase() !== 'unknown'
  );
}

function pick(...arr) {
  for (const v of arr) {
    if (has(v)) return v;
  }
  return '';
}

function safe(v, d = '—') {
  return has(v) ? String(v).trim() : d;
}

function list(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'unknown';
  if (typeof v === 'string') return v.trim() || 'unknown';
  return 'unknown';
}

function truncate(str, max = 3500) {
  const s = String(str || '').trim();
  return s.length > max ? s.slice(0, max) + '\n\n...(truncated)' : s;
}

// Empty-message fallback gate.
// Do not manufacture a generic re-engagement message here: repeated fallback
// copy is a quality issue and should be held for manual rewrite.
function generateFallbackMessage(customerName, hardNoSend) {
  return '';
}

function generateFallbackMessageCn(customerName, hardNoSend) {
  return '';
}

// Banned phrase detection — hard-coded regex since AI doesn't reliably follow prompt-level bans
const BANNED_PATTERNS = [
  { name: 'simplify_last', regex: /simplify\s+(my|our|the)\s+last\s+(point|message|interaction|chat|reply|exchange|response)/i },
  { name: 'summarize_last', regex: /summarize\s+(my|our|the)\s+last\s+(point|message|interaction)/i },
  { name: 'pick_up_where', regex: /pick\s+up\s+where\s+we\s+left\s+off/i },
  { name: 'catch_up_on', regex: /catch\s+up\s+on\s+(what\s+we|where\s+we|our|the\s+key)/i },
  { name: 'last_point', regex: /\b(my|our|the)\s+last\s+point\b/i },
  { name: 'last_interaction', regex: /\b(my|our|the)\s+last\s+interaction\b/i },
  { name: 'latest_models_vague', regex: /(the\s+latest|our\s+latest)\s+(equipment\s+)?(options|models|updates)(?!\s+(of|for|that|which|such))/i },
  { name: 'new_model_options_vague', regex: /(line\s+up|keep)\s+(the\s+)?new\s+model\s+options/i },
  { name: 'see_whats_available', regex: /see\s+what[''\u2019]?s\s+available/i },
  { name: 'make_informed_choice', regex: /make\s+(an|a)\s+informed\s+choice/i },
  { name: 'at_your_convenience', regex: /at\s+your\s+convenience/i },
  // 2026-04-23: defense against sparse-history fallback drift (4/22 batch 5/50)
  { name: 'circling_back', regex: /circling\s+back/i },
  { name: 'still_considering', regex: /still\s+considering/i },
  // Chinese chars in greeting (before first comma) — name-pollution defense
  { name: 'chinese_in_greeting', regex: /^[^,]*[\u4e00-\u9fff]/ }
];

function detectBannedPhrases(message) {
  if (!message || typeof message !== 'string') return [];
  const hits = [];
  for (const { name, regex } of BANNED_PATTERNS) {
    const match = message.match(regex);
    if (match) hits.push({ name, matched: match[0] });
  }
  return hits;
}

function compressSummary(text, maxLen = 400) {
  if (!text) return '信息不足';

  const cleaned = String(text)
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '信息不足';
  if (cleaned.length <= maxLen) return cleaned;

  const headLen = Math.min(220, Math.floor(maxLen * 0.65));
  const tailLen = Math.min(120, maxLen - headLen - 5);

  const head = cleaned.slice(0, headLen);
  const tail = cleaned.slice(-tailLen);

  return `${head} ... ${tail}`;
}

function getEnforceParsed(item) {
  const rawText =
    item.json?.output?.[0]?.content?.[0]?.text ||
    item.json?.content?.[0]?.text ||
    '{}';

  const parsed = parseJsonSafe(rawText);

  const whatsapp_message = (parsed.whatsapp_message || '').trim();

  return {
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    whatsapp_message
  };
}

function getOriginalAiParsed(current) {
  if (current.ai_parsed && typeof current.ai_parsed === 'object') {
    return current.ai_parsed;
  }
  return {};
}

function isEmptyMessage(msg) {
  return !has(msg);
}

function normalizeText(msg) {
  return String(msg || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasHighRiskPattern(msg) {
  const text = normalizeText(msg);

  const bannedPatterns = [
    'just checking',
    'checking in',
    'any update',
    'following up',
    'circling back',
    'still considering',
    'let me know',
    'still interested',
    'would love to help',
    'feel free to',
    'looking forward to hearing from you',
    'full catalog',
    'all the options',
    'all options available',
    'full accessories list',
    'material preference',
    'share more details',
    'more details',
    'setup details',
    'deposit now',
    'prepare the pi',
    '30% deposit',
    'lock in the current pricing',
    'secure the pricing',
    'does that work for you',
    'would that work for you',
    'is that okay for you',
    'match the cheaper options',
    'match the price',
    'offer something better',
    'recommend suitable',
    'based on your needs',
    'based on your current plan',
    'narrow down the options',
    'most suitable options',
    'see all options available'
  ];

  return bannedPatterns.some(p => text.includes(p));
}

function hasTooManyQuestions(msg) {
  const matches = String(msg || '').match(/\?/g);
  return matches && matches.length > 1;
}

function hasOrRisk(msg) {
  return /\bor\b/i.test(String(msg || ''));
}

function hasDecisionRisk(msg) {
  return /\bdecide\b|\bdecision\b|\bpurchase\b|\bcompare\b|\bpreference\b|\bwhich\b|\bbetter\b|\bwork for you\b|\bokay for you\b/i.test(String(msg || ''));
}

function hasGenericRisk(msg) {
  const text = normalizeText(msg);

  const genericPatterns = [
    'help with that',
    'help you with that',
    'help with this',
    'help you with this',
    'make this easier',
    'do that for you',
    'do this for you',
    'help you decide',
    'help clarify everything',
    'check if we can',
    'recommend options'
  ];

  return genericPatterns.some(p => text.includes(p));
}

function hasWeakAnchorRisk(msg) {
  const text = normalizeText(msg);
  if (/\b(?:ar|mr|or|fr|mg|pr|pc|bs)\d{3}\b/i.test(String(msg || ''))) {
    return false;
  }

  const anchorPatterns = [
    'pricing',
    'price range',
    'quote',
    'setup',
    'model',
    'models',
    'reformer',
    'reformers',
    'ar010',
    'ar011',
    'ar012',
    'bs001',
    'pk001',
    'sample',
    'october',
    'houston',
    '77044',
    'warranty',
    'shipping',
    'landed cost',
    'postal code',
    'zip code',
    'production',
    'payment',
    'invoice'
  ];

  return !anchorPatterns.some(p => text.includes(p));
}

function normalizeForSimilarity(msg) {
  return String(msg || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(msg) {
  const stopWords = new Set([
    'the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'can', 'our',
    'here', 'want', 'send', 'share', 'see', 'what', 'good', 'fit', 'just',
    'have', 'will', 'would', 'could', 'please', 'thanks', 'thank'
  ]);

  return normalizeForSimilarity(msg)
    .split(' ')
    .filter(token => token.length > 2 && !stopWords.has(token));
}

function similarityScore(a, b) {
  const aTokens = new Set(tokenizeForSimilarity(a));
  const bTokens = new Set(tokenizeForSimilarity(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(aTokens.size, bTokens.size);
}

function looksTooSimilar(candidate, previous) {
  const a = normalizeForSimilarity(candidate);
  const b = normalizeForSimilarity(previous);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 45 && b.includes(a)) return true;
  if (b.length >= 45 && a.includes(b)) return true;
  return similarityScore(a, b) >= 0.72;
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function historyTextsFrom(value) {
  return parseMaybeJsonArray(value)
    .map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return item.ai_message || item.whatsapp_message || item.message || item.text || '';
    })
    .filter(text => has(text));
}

function getDoNotRepeatList(current) {
  const direct = current.forbidden_repeat_zone?.do_not_repeat;
  const payload = current.reactivation_ai_payload?.constraints?.do_not_repeat;
  const core = current.reactivation_v6_core?.forbidden_repeat_zone?.do_not_repeat;
  const values = [direct, payload, core].find(Array.isArray);
  return Array.isArray(values) ? values : [];
}

function getAlreadyAskedQuestions(current) {
  const direct = current.forbidden_repeat_zone?.already_asked_questions;
  const core = current.reactivation_v6_core?.forbidden_repeat_zone?.already_asked_questions;
  const values = [direct, core].find(Array.isArray);
  return Array.isArray(values) ? values : [];
}

function detectRepeatQualityHits(message, current, usedFallback) {
  const hits = [];
  const text = normalizeText(message);
  const doNotRepeat = getDoNotRepeatList(current);
  const priorTexts = [
    current.last_my_message,
    ...historyTextsFrom(current.previous_activation_messages),
    ...historyTextsFrom(current.prior_activation_messages),
    ...historyTextsFrom(current.recent_activation_messages),
    ...historyTextsFrom(current.previous_ai_messages)
  ].filter(value => has(value));

  for (const previous of priorTexts) {
    if (looksTooSimilar(message, previous)) {
      hits.push({ name: 'repeat_prior_message', matched: String(previous).slice(0, 140) });
      break;
    }
  }

  if (usedFallback && (current.message_count || current.last_my_message || current.last_customer_message)) {
    hits.push({ name: 'fallback_used_with_history', matched: 'fallback template used despite existing history' });
  }

  if (/most popular studio setup options|studio setup options|good fit/i.test(message)) {
    hits.push({ name: 'generic_studio_setup_fallback', matched: 'most popular studio setup options' });
  }

  if (doNotRepeat.includes('repeat_same_question')) {
    const alreadyAsked = getAlreadyAskedQuestions(current);
    const candidateQuestion = (String(message).match(/[^?？.!。！]*[?？]/g) || []).join(' ');
    if (candidateQuestion && alreadyAsked.some(question => looksTooSimilar(candidateQuestion, question))) {
      hits.push({ name: 'repeat_same_question', matched: candidateQuestion.slice(0, 140) });
    }
  }

  if (!text) {
    hits.push({ name: 'empty_message', matched: 'empty message' });
  }

  return hits;
}

function cleanDisplayName(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (!value || value === '未命名客户' || /^\+?\d[\d\s().-]*$/.test(value)) return '';

  const cleaned = value
    .replace(/\b(?:ar|mr|or|fr|mg|pr|pc|bs)\d{3}\b/gi, ' ')
    .replace(/\d+台/g, ' ')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[（()）]+/g, ' ')
    .replace(/\d{1,4}[\.\-\/]\d{1,2}[\.\-\/]?\d{0,2}日?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = cleaned.match(/[A-Za-z][A-Za-z.'-]*/);
  return match ? match[0] : '';
}

function displayNameForMessage(current, fallbackName) {
  const name = cleanDisplayName(
    current.customer_name_for_ai ||
    current.customer_name_clean ||
    fallbackName ||
    current.customer_name ||
    current.project_key
  );
  return name || 'Hi there';
}

function shouldRewriteToAlternateActivation(message) {
  if (!has(message)) return true;
  return /most popular studio setup options|studio setup options|good fit/i.test(message);
}

function buildAlternateActivationMessage(current, customerName) {
  const name = displayNameForMessage(current, customerName);
  const prefix = name === 'Hi there' ? 'Hi there' : name;
  const lastMyMessage = normalizeText(current.last_my_message);

  if (/\b(delivery city|postal code|zip code|shipping|landed cost|delivery price|freight)\b/i.test(lastMyMessage)) {
    return {
      en: `${prefix}, I can show you how we calculate the landed cost step by step, so you know what affects the final delivery price before sharing the address details — want me to send that here?`,
      cn: `${prefix}，我可以一步步说明我们如何计算落地成本，这样你在提供地址信息前就能先了解最终配送价格受哪些因素影响——要我发在这里吗？`
    };
  }

  if (/\b(price|pricing|quote|pi|invoice|payment|deposit|total|unit price|rate)\b/i.test(lastMyMessage)) {
    return {
      en: `${prefix}, I can outline the next steps from confirmation to production and delivery so you can see how the order would move forward — want me to send that here?`,
      cn: `${prefix}，我可以整理从确认到生产和交付的下一步流程，这样你能清楚看到订单会如何推进——要我发在这里吗？`
    };
  }

  if (/\b(catalog|option|options|model|models|recommend|setup|compare|comparison)\b/i.test(lastMyMessage)) {
    return {
      en: `${prefix}, I can send a short comparison checklist so you can review the main differences without going through the whole catalog again — want me to send that here?`,
      cn: `${prefix}，我可以发一份简短对比清单，这样你不用重新看完整目录，也能快速核对主要差异——要我发在这里吗？`
    };
  }

  return {
    en: `${prefix}, I can send a short starting-point guide for choosing the right Pilates reformer setup so you have something concrete to review — want me to send that here?`,
    cn: `${prefix}，我可以发一份选择合适普拉提床配置的简短入门指南，这样你可以先看一个具体方向——要我发在这里吗？`
  };
}

function synthesizeChineseReference(message) {
  if (!has(message)) return '';
  const text = String(message).trim();
  const nameMatch = text.match(/^([^,]+),\s+/);
  const name = nameMatch ? nameMatch[1].trim() : '';
  const cnName = name && name !== 'Hi there' ? `${name}，` : '';

  const orderMatch = text.match(/put together the unit pricing and delivery timeline for your (.+?) so you can plan the resale rollout/i);
  if (orderMatch) {
    return `${cnName}我可以整理你这笔 ${orderMatch[1].trim()} 的单价和交付时间线，这样你可以规划后续转售推进——要我发在这里吗？`;
  }

  if (/outline the next steps from confirmation to production and delivery/i.test(text)) {
    return `${cnName}我可以整理从确认到生产和交付的下一步流程，这样你能清楚看到订单会如何推进——要我发在这里吗？`;
  }

  if (/short comparison checklist/i.test(text)) {
    return `${cnName}我可以发一份简短对比清单，这样你不用重新看完整目录，也能快速核对主要差异——要我发在这里吗？`;
  }

  if (/calculate the landed cost step by step/i.test(text)) {
    return `${cnName}我可以一步步说明我们如何计算落地成本，这样你在提供地址信息前就能先了解最终配送价格受哪些因素影响——要我发在这里吗？`;
  }

  if (/starting-point guide for choosing the right Pilates reformer setup/i.test(text)) {
    return `${cnName}我可以发一份选择合适普拉提床配置的简短入门指南，这样你可以先看一个具体方向——要我发在这里吗？`;
  }

  if (/shipping and setup works for the Philippines/i.test(text) || /from delivery to assembly/i.test(text)) {
    return `${cnName}我可以简单说明发货和安装/组装在菲律宾这边是怎么进行的，这样你可以清楚了解从送达到组装具体涉及哪些内容——要我发在这里吗？`;
  }

  return '';
}

function hasIncompleteChineseReference(value) {
  if (!has(value)) return true;
  const text = String(value).trim();
  if (text.includes('未提供中文对照')) return true;
  if (text.includes('相关选项') || text.includes('这一步需要看的重点内容')) return true;
  return !/[\u4e00-\u9fff]/.test(text);
}

function sanitizeCustomerGreeting(message, current, fallbackName) {
  if (!has(message)) return message;
  const text = String(message).trim();
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0 || commaIndex > 80) return text;

  const greeting = text.slice(0, commaIndex).trim();
  const rest = text.slice(commaIndex + 1).trimStart();
  if (!greeting || !rest) return text;

  const hasDirtyGreeting =
    /[\u4e00-\u9fff]/.test(greeting) ||
    /\d+台/.test(greeting) ||
    /\b(?:ar|mr|or|fr|mg|pr|pc|bs)\d{3}\b/i.test(greeting) ||
    /^\+?\d[\d\s().-]*$/.test(greeting);

  if (!hasDirtyGreeting) return text;

  const cleanName = displayNameForMessage(current, fallbackName);
  return `${cleanName}, ${rest}`;
}

function uniqueHits(hits) {
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const key = `${hit.name}:${hit.matched || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

const zh = {
  stage: v => ({
    outreach: '初步触达',
    engaged: '已互动',
    evaluating: '评估中',
    price: '询价阶段',
    ready: '准备成交'
  }[v] || safe(v, '未知')),

  priority: v => ({
    high: '高',
    medium: '中',
    low: '低'
  }[v] || '未定义'),

  status: v => ({
    waiting_for_me: '等待我方回复',
    waiting_for_customer: '等待客户回复',
    open: '进行中'
  }[v] || '未定义'),

  intent: v => ({
    high: '高',
    medium: '中',
    low: '低'
  }[v] || '未知'),

  purchase: v => ({
    information_gathering: '信息收集',
    selection: '选型阶段',
    pricing: '价格确认',
    closing: '成交推进'
  }[v] || '未知'),

  customer: v => ({
    studio_owner: '工作室客户',
    distributor_or_reseller: '经销/分销',
    end_user: '终端用户',
    commercial_facility: '商业机构',
    small_business_operator: '小型经营者',
    individual_practitioner: '个人从业者',
    commercial_buyer: '商业采购客户'
  }[v] || '未知')
};

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

function filterAndFormatTelegramFinalItems(items) {
  const out = [];

  for (const item of items) {
    const current = item.json || {};

    const aiParsed = getOriginalAiParsed(current);
    const enforceParsed = getEnforceParsed(item);

    const projectKey = pick(current.project_key, aiParsed.project_key, '未命名客户');
    const customerName = pick(current.customer_name, aiParsed.customer_name, projectKey);

    const stage = pick(current.stage, aiParsed.stage);
    const priority = pick(current.follow_up_priority, aiParsed.follow_up_priority);
    const status = pick(current.status, aiParsed.status);

    const customerType = pick(current.customer_type, aiParsed.customer_type);
    const intent = pick(current.intent_level, aiParsed.intent_level);
    const purchaseStage = pick(current.purchase_stage, aiParsed.purchase_stage);

    const product = list(pick(current.product_interest, aiParsed.product_interest));
    const quantity = list(pick(current.quantity_signal, aiParsed.quantity_signal));
    const concerns = list(pick(current.concerns, aiParsed.concerns));
    const signals = list(pick(current.key_signals, aiParsed.key_signals));

    const lastCustomerTime = safe(
      pick(current.last_customer_message_time, current.last_customer_message_time_normalized),
      'unknown'
    );

    const lastMyTime = safe(
      pick(current.last_my_message_time, current.last_my_message_time_normalized),
      'unknown'
    );

    const gap = safe(current.last_customer_gap_hint, '—');

    const blocker = safe(
      pick(current.current_blocker, aiParsed.current_blocker),
      '信息不足'
    );

    const strategy = pick(
      current.strategy_direction,
      aiParsed.selected_strategy,
      'unknown'
    );

    const angle = safe(
      pick(current.reply_angle, aiParsed.why_this_strategy),
      '信息不足'
    );

    const focus = safe(
      pick(current.follow_up_focus, aiParsed.best_reply_trigger),
      '信息不足'
    );

    const summary = safe(
      pick(
        aiParsed.conversation_summary,
        current.dated_history_summary,
        current.timeline_summary,
        current.conversation_summary,
        current.conversation_core
      ),
      '信息不足'
    );

    const shortSummary = compressSummary(summary, 400);

    const customerSignal = safe(
      pick(aiParsed.customer_signal, current.customer_signal, current.key_signals),
      '信息不足'
    );

    const state = safe(
      pick(aiParsed.conversation_state, current.conversation_state, current.timeline_conversation_status),
      '信息不足'
    );

    const reasoning = safe(
      pick(aiParsed.reasoning_summary, angle),
      '信息不足'
    );

    const confidence = safe(
      pick(aiParsed.confidence, current.confidence),
      '中'
    );

    const aiSummary = safe(aiParsed.analysis_text, '未输出');

    let finalMessage = safe(enforceParsed.whatsapp_message, '');

    let finalMessageCn = safe(
      pick(
        enforceParsed.whatsapp_message_cn,
        current.whatsapp_message_cn,
        aiParsed.whatsapp_message_cn,
        current._cn
      ),
      ''
    );

    // If AI returned empty, keep it empty so n8n can route it to missing_ai_message
    // or quality review. Do not fill with a repeated generic fallback.
    let usedFallback = false;
    if (isEmptyMessage(finalMessage)) {
      const fallbackEn = generateFallbackMessage(customerName, current.hard_no_send);
      if (fallbackEn) {
        finalMessage = fallbackEn;
        finalMessageCn = generateFallbackMessageCn(customerName, current.hard_no_send);
        usedFallback = true;
      }
    }

    const targetReply = safe(aiParsed.target_reply, '未输出');
    const hardNoSend = current.hard_no_send === true || current.hard_no_send === 'true';

    let usedAlternateActivation = false;
    if (!hardNoSend && shouldRewriteToAlternateActivation(finalMessage)) {
      const alternate = buildAlternateActivationMessage(current, customerName);
      finalMessage = alternate.en;
      finalMessageCn = alternate.cn;
      usedAlternateActivation = true;
    }

    finalMessage = sanitizeCustomerGreeting(finalMessage, current, customerName);

    if (hasIncompleteChineseReference(finalMessageCn)) {
      finalMessageCn = synthesizeChineseReference(finalMessage);
    }

    const emptyMessage = isEmptyMessage(finalMessage);
    const highRisk = hasHighRiskPattern(finalMessage);
    const multiQuestionRisk = hasTooManyQuestions(finalMessage);
    const orRisk = hasOrRisk(finalMessage);
    const decisionRisk = hasDecisionRisk(finalMessage);
    const genericRisk = hasGenericRisk(finalMessage);
    const weakAnchorRisk = hasWeakAnchorRisk(finalMessage);
    const repeatQualityHits = detectRepeatQualityHits(finalMessage, current, usedFallback);

    const missingChineseReference = hasIncompleteChineseReference(finalMessageCn);
    const shouldBlock = emptyMessage || missingChineseReference;

    const multiRisk = multiQuestionRisk || orRisk ? '高' : '低';
    const thinkRisk = decisionRisk ? '高' : '低';

    const enforceStatus = usedFallback
      ? 'fallback_used'
      : emptyMessage
        ? 'empty_skip'
        : shouldBlock
          ? 'blocked'
          : hardNoSend
            ? 'hard_no_send_flagged'
            : 'pass';

    const analysisText = truncate([
      `客户名称：${customerName}`,
      '',
      `阶段：${zh.stage(stage)} ｜ 优先级：${zh.priority(priority)} ｜ 状态：${zh.status(status)}`,
      '',
      '客户分析：',
      `客户类型：${zh.customer(customerType)}`,
      `意向等级：${zh.intent(intent)}`,
      `采购阶段：${zh.purchase(purchaseStage)}`,
      `关注产品：${product}`,
      `数量信号：${quantity}`,
      `关注点：${concerns}`,
      `关键信号：${signals}`,
      '',
      '历史沟通回顾：',
      shortSummary,
      '',
      '关键时间节点：',
      `客户最后回复：${lastCustomerTime}`,
      `我方最后发送：${lastMyTime}`,
      '',
      '时间间隔：',
      gap,
      '',
      '当前判断：',
      `客户信号：${customerSignal}`,
      `当前状态：${state}`,
      '',
      `当前阻碍：${blocker}`,
      `策略方向：${strategy}`,
      `回复角度：${angle}`,
      `跟进焦点：${focus}`,
      '',
      '分析信心：',
      confidence,
      '',
      'AI分析摘要：',
      aiSummary,
      '',
      '推理摘要：',
      reasoning,
      '',
      'Enforce执行检查：',
      `Enforce状态：${enforceStatus}`,
      `目标回复：${targetReply}`,
      `多路径风险：${multiRisk}`,
      `思考负担风险：${thinkRisk}`,
      `高风险词拦截：${highRisk ? '是' : '否'}`,
      `泛化表达拦截：${genericRisk ? '是' : '否'}`,
      `弱锚点拦截：${weakAnchorRisk ? '是' : '否'}`,
      `重复角度拦截：${repeatQualityHits.length > 0 ? '是' : '否'}`,
      `完整中文翻译缺失：${missingChineseReference ? '是' : '否'}`,
      '',
      '建议跟进话术（最终英文）：',
      finalMessage ? `✅ ${finalMessage}` : '⛔ 空消息，不发送',
      '',
      '建议跟进话术（中文对照）：',
      finalMessageCn ? `✅ ${finalMessageCn}` : '⛔ 未提供中文对照'
    ].join('\n'), 3500);

    const deterministicQualityHits = [
      ...detectBannedPhrases(finalMessage),
      ...(highRisk ? [{ name: 'high_risk_pattern', matched: 'high-risk or banned follow-up pattern' }] : []),
      ...(genericRisk ? [{ name: 'generic_expression', matched: 'generic expression' }] : []),
      ...repeatQualityHits
    ];
    const bannedHits = uniqueHits(deterministicQualityHits);

    const headerParts = [];
    if (hardNoSend) {
      headerParts.push('⛔ HARD_NO_SEND ⛔\n客户曾发出"暂时不要联系"信号,默认不发,如确实要发请人工 review 客户最新消息后再决定。');
    }
    if (bannedHits.length > 0) {
      headerParts.push(`⚠️ BANNED_PHRASE_DETECTED ⚠️\nMatched: "${bannedHits.map(h => h.matched).join('" / "')}"\n请在 Telegram 审核时手动改写后再发送。`);
    } else if (missingChineseReference) {
      headerParts.push('⛔ MISSING_COMPLETE_CN_TRANSLATION ⛔\n缺少完整中文翻译，不能进入正常 Telegram 发送。请先让上游 AI/API 输出 whatsapp_message_cn。');
    } else if (usedFallback) {
      headerParts.push('🔄 FALLBACK 通用破冰模板\nAI 没有足够上下文，使用了通用模板。建议根据客户情况手动改写后再发送。');
    }
    const reviewHeader = headerParts.length > 0 ? headerParts.join('\n\n') + '\n\n' : '';

    const telegramMessages = !shouldBlock
      ? [
          `${reviewHeader}【${projectKey}】\n\nEnglish:\n${finalMessage}\n\n中文翻译:\n${finalMessageCn || '（未提供中文对照）'}`,
          current.project_key || '',
          finalMessage
        ]
      : [];

    out.push({
      ...current,
      ai_parsed: aiParsed,
      enforce_parsed: enforceParsed,
      project_key: projectKey,
      customer_name: customerName,
      order_group: has(current.order_group) ? String(current.order_group).trim() : '',
      analysis_text: analysisText,
      whatsapp_text: finalMessage,
      whatsapp_message: finalMessage,
      _en: finalMessage,
      whatsapp_message_cn: finalMessageCn,
      telegram_messages: telegramMessages,
      enforce_status: enforceStatus,
      auto_send_pass: !shouldBlock,
      banned_phrase_flagged: false,
      banned_phrase_hits: [],
      banned_phrase_details: '[]',
      quality_issue_hits: bannedHits,
      missing_chinese_reference: missingChineseReference,
      used_alternate_activation: usedAlternateActivation,
      used_fallback: usedFallback
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
    const resultItems = filterAndFormatTelegramFinalItems(inputItems);
    return res.status(200).json(resultItems);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'filter-and-format-telegram-final failed'
    });
  }
};
