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

function boolFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  }
  return false;
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

function assessCandidateQuality(message, current, usedFallback) {
  const emptyMessage = isEmptyMessage(message);
  const highRisk = hasHighRiskPattern(message);
  const multiQuestionRisk = hasTooManyQuestions(message);
  const orRisk = hasOrRisk(message);
  const decisionRisk = hasDecisionRisk(message);
  const genericRisk = hasGenericRisk(message);
  const weakAnchorRisk = hasWeakAnchorRisk(message);
  const repeatQualityHits = detectRepeatQualityHits(message, current, usedFallback);
  const deterministicQualityHits = [
    ...detectBannedPhrases(message),
    ...(highRisk ? [{ name: 'high_risk_pattern', matched: 'high-risk or banned follow-up pattern' }] : []),
    ...(genericRisk ? [{ name: 'generic_expression', matched: 'generic expression' }] : []),
    ...(weakAnchorRisk && !hasConcreteContextAnchor(current) ? [{ name: 'weak_anchor', matched: 'weak anchor without concrete context' }] : []),
    ...repeatQualityHits
  ];
  const bannedHits = uniqueHits(deterministicQualityHits);
  const qualityBlock =
    highRisk ||
    genericRisk ||
    (weakAnchorRisk && !hasConcreteContextAnchor(current)) ||
    repeatQualityHits.length > 0 ||
    bannedHits.length > 0;

  return {
    emptyMessage,
    highRisk,
    multiQuestionRisk,
    orRisk,
    decisionRisk,
    genericRisk,
    weakAnchorRisk,
    repeatQualityHits,
    bannedHits,
    qualityBlock
  };
}

function cleanDisplayName(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (
    !value ||
    value === '未命名客户' ||
    /^hi\s+there$/i.test(value) ||
    /^there$/i.test(value) ||
    /^\+?\d[\d\s().-]*$/.test(value)
  ) return '';

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
  // 2026-07-08: empty message must stay empty and route to manual review
  // (enforce_status=empty_skip). Do not manufacture an alternate activation
  // just to guarantee output.
  if (!has(message)) return false;
  return /most popular studio setup options|studio setup options|good fit|short comparison checklist|main differences without going through the whole catalog|short starting-point guide|something concrete to review|next steps from confirmation to production and delivery|calculate the landed cost step by step/i.test(message);
}

function textFromMessages(messages) {
  if (!Array.isArray(messages)) return '';
  return messages
    .map(message => {
      if (!message || typeof message !== 'object') return '';
      return message.message || message.text || '';
    })
    .filter(value => has(value))
    .join(' ');
}

function contextText(current) {
  return [
    current.last_customer_message,
    current.last_my_message,
    current.recent_conversation,
    current.cleaned_full_conversation,
    current.conversation_core,
    current.timeline_summary,
    current.dated_history_summary,
    textFromMessages(current.messages),
    textFromMessages(current.recent_messages)
  ].filter(value => has(value)).join(' ');
}

function uniqueMatches(text, regex, limit = 3) {
  const matches = [];
  const seen = new Set();
  const source = String(text || '');
  let match;
  while ((match = regex.exec(source)) !== null) {
    const value = (match[1] || match[0] || '').trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      matches.push(value);
    }
    if (matches.length >= limit) break;
  }
  return matches;
}

function extractContextSignals(current) {
  const fullText = contextText(current);
  const lastMy = String(current.last_my_message || '');
  const lastCustomer = String(current.last_customer_message || '');
  const priorityText = [lastCustomer, lastMy, fullText].filter(value => has(value)).join(' ');

  return {
    text: fullText,
    lastMy,
    lastCustomer,
    models: uniqueMatches(priorityText, /\b(?:AR|MR|OR|FR|MG|PR|PC|BS)\d{3}\b/gi, 4),
    prices: uniqueMatches(priorityText, /(?:USD\s*)?\$[\d,]+(?:\.\d+)?|\bUSD\s*[\d,]+(?:\.\d+)?/gi, 4),
    quantities: uniqueMatches(priorityText, /\b\d+\s*[–-]\s*\d+\s*(?:units?|pcs?|pieces?|reformers?|towers?)\b|\b\d+\s*(?:units?|pcs?|pieces?|reformers?|towers?)\b/gi, 3),
    zips: uniqueMatches(priorityText, /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{5}(?:-\d{4})?\b/gi, 2),
    countries: uniqueMatches(priorityText, /\b(?:Philippines|Canada|USA|US|Australia|New Zealand|Sri Lanka)\b/gi, 2)
  };
}

function normalizeReasonList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeReasonList(parsed);
    } catch {
      // Fall through to comma splitting.
    }
    return trimmed.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function hasUsableConversationSummaryValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length >= 40 && !['null', '{}', '[]', '信息不足'].includes(trimmed);
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function hasUsableRuntimeConversationSummary(current) {
  const summary = current.runtime_conversation_summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  const customerCount = Number(summary.customer_message_count);
  const sellerCount = Number(summary.seller_message_count);
  const messageCount = Number(summary.message_count);

  if (summary.source === 'full_history_runtime') {
    return customerCount > 0 && sellerCount > 0 && messageCount >= 2;
  }

  return (
    summary.source === 'seller_history_runtime' &&
    customerCount === 0 &&
    sellerCount >= 2 &&
    messageCount >= 2 &&
    hasConcreteContextAnchor(current)
  );
}

function hasConcreteContextAnchor(current) {
  const signals = extractContextSignals(current);
  if (signals.models.length || signals.prices.length || signals.quantities.length || signals.zips.length || signals.countries.length) {
    return true;
  }

  return /\b(?:catalog|brochure|pdf|photos?|pictures?|videos?|warranty|shipping|freight|delivery|ddp|invoice|pi|deposit|payment|quote|pricing|price|october|studio|distributor|dealer|reseller)\b/i
    .test(signals.text);
}

function hasWeakIdentity(current) {
  const raw = String(current.customer_name_for_ai || current.customer_name_clean || current.customer_name || current.project_key || '').trim();
  if (!raw) return true;
  if (/^hi\s+there$/i.test(raw) || /^there$/i.test(raw)) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(raw)) return true;
  return /^(unknown|test|facebook|facebook business|meta|meta business|未命名客户)$/i.test(raw);
}

function hasNoHistoryPermissionCheck(current) {
  const sendState = String(
    current.send_state || current.reactivation_ai_payload?.decision?.send_state || ''
  ).trim();
  const anchor = String(
    current.primary_reply_anchor ||
    current.anchor_object ||
    current.reactivation_ai_payload?.decision?.anchor_object ||
    ''
  ).trim();
  const reason = String(
    current.reactivation_ai_payload?.decision?.best_trigger_reason ||
    current.reactivation_decision_basis?.best_trigger_reason ||
    ''
  ).trim();
  const allowedTriggers = [
    current.allowed_micro_triggers,
    current.reactivation_ai_payload?.decision?.allowed_micro_triggers,
    current.reactivation_v6_core?.allowed_micro_triggers
  ].find(Array.isArray) || [];
  const stage = normalizeText(current.stage);
  const hasMessageEvidence = [
    current.last_customer_message,
    current.last_my_message,
    current.customer_only_text,
    current.customer_recent_only_text,
    current.cleaned_full_conversation,
    textFromMessages(current.messages),
    textFromMessages(current.recent_messages)
  ].some(value => has(value));
  const hasRuntimeSummary = Boolean(
    current.runtime_conversation_summary &&
    typeof current.runtime_conversation_summary === 'object' &&
    Object.keys(current.runtime_conversation_summary).length
  );

  return (
    sendState === 'rewrite_needed' &&
    anchor === 'pilates_equipment_project_status' &&
    reason === 'no_history_permission_check_only' &&
    allowedTriggers.includes('confirm_current_pilates_project_here') &&
    ['engaged', 'outreach'].includes(stage) &&
    !hasWeakIdentity(current) &&
    !hasRuntimeSummary &&
    !hasMessageEvidence
  );
}

function getManualHoldReasons(current) {
  const directReasons = [
    ...normalizeReasonList(current.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_ai_payload?.decision?.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_ai_payload?.stop_point?.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_decision_basis?.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_v6_core?.manual_hold_reasons)
  ];

  const reasons = [...directReasons];
  const sendState = String(current.send_state || current.reactivation_ai_payload?.decision?.send_state || '').trim();
  const hardNoSend = boolFlag(current.hard_no_send);
  const hasNotNowSignal = boolFlag(current.has_not_now_signal);
  const isMyTurnToReply = boolFlag(current.is_my_turn_to_reply);
  const concreteAnchor = hasConcreteContextAnchor(current);
  const runtimeSummary = hasUsableRuntimeConversationSummary(current);
  const noHistoryPermissionCheck = hasNoHistoryPermissionCheck(current);
  const lastCustomer = String(current.last_customer_message || '').trim();
  const customerText = [
    current.customer_only_text,
    current.customer_recent_only_text,
    textFromMessages(current.messages),
    textFromMessages(current.recent_messages)
  ].filter(value => has(value)).join(' ').trim();

  if (hardNoSend) reasons.push('hard_no_send');
  if (hasNotNowSignal) reasons.push('has_not_now_signal');
  if (sendState === 'no_send') reasons.push('send_state_no_send');
  if (sendState === 'manual_context_required') reasons.push('send_state_manual_context_required');
  if (isMyTurnToReply) reasons.push('my_turn_requires_manual_reply');
  if (!lastCustomer && !customerText && !runtimeSummary && !noHistoryPermissionCheck) {
    reasons.push('missing_customer_context');
  }
  if (lastCustomer && lastCustomer.length < 20 && customerText.length < 80 && !concreteAnchor) {
    reasons.push('very_short_customer_context_without_anchor');
  }
  if (
    !hasUsableConversationSummaryValue(current.conversation_summary) &&
    !runtimeSummary &&
    !concreteAnchor &&
    !noHistoryPermissionCheck
  ) {
    reasons.push('missing_summary_without_concrete_anchor');
  }
  if (hasWeakIdentity(current) && !concreteAnchor) {
    reasons.push('weak_identity_without_concrete_anchor');
  }

  return [...new Set(reasons)];
}

function joinHumanList(values, fallback) {
  const arr = (values || []).filter(value => has(value));
  if (!arr.length) return fallback;
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
}

function objectFromSignals(signals, fallback = 'Reformer setup') {
  const modelPart = joinHumanList(signals.models, '');
  const quantityPart = joinHumanList(signals.quantities, '');
  if (modelPart && quantityPart) {
    const compactQuantity = quantityPart.replace(/\s+units?\b/i, '-unit');
    return `${compactQuantity} ${modelPart} setup`;
  }
  if (modelPart) return modelPart;
  if (quantityPart) return `${quantityPart} Reformer setup`;
  return fallback;
}

function objectForChinese(object) {
  if (!has(object)) return 'Reformer 配置';
  if (object === 'the models we discussed') return '之前讨论的型号';
  return object;
}

function placeForSentence(place) {
  if (!has(place)) return 'your delivery area';
  if (/^(Philippines|USA|US|United States|UK|UAE)$/i.test(place)) return `the ${place}`;
  return place;
}

function withHumanCta(prefix, body) {
  return `${prefix}, ${body}`;
}

function buildAlternateActivationMessage(current, customerName) {
  const name = displayNameForMessage(current, customerName);
  const prefix = name === 'Hi there' ? 'Hi there' : name;
  const lastMyMessage = normalizeText(current.last_my_message);
  const lastCustomerMessage = normalizeText(current.last_customer_message);
  const signals = extractContextSignals(current);
  const object = objectFromSignals(signals);
  const prices = joinHumanList(signals.prices, '');
  const country = joinHumanList(signals.countries, '');
  const zip = joinHumanList(signals.zips, '');
  const cnObject = objectForChinese(object);

  if (current.hard_no_send === true || current.hard_no_send === 'true' || current.has_not_now_signal === true || current.has_not_now_signal === 'true') {
    // 2026-07-08: hard_no_send / not_now must never receive a manufactured
    // "lighter care" activation. Return null so the caller blocks the row.
    // (Normally unreachable because these flags already create manual hold
    // reasons upstream; kept as defense in depth.)
    return null;
  }

  if (/yes please|sure|ok|okay|thank/i.test(lastCustomerMessage) && /\b(photo|photos|video|videos)\b/i.test(lastMyMessage)) {
    return {
      en: withHumanCta(prefix, `I can pull the key ${object} frame and finish details from the photos into one quick note, so you do not need to replay every file.`),
      cn: `${prefix}，我可以把照片里 ${cnObject} 的框架和做工重点整理成一条简短说明，这样你不用反复打开每个文件。`
    };
  }

  if (/\b(delivery city|postal code|zip code|shipping|landed cost|delivery price|freight)\b/i.test(lastMyMessage)) {
    const place = placeForSentence(zip || country || 'your delivery area');
    return {
      en: withHumanCta(prefix, `I can lay out what affects shipping the ${object} to ${place}, so the landed-cost part is clearer before we calculate the final number.`),
      cn: `${prefix}，我可以先说明 ${cnObject} 发到 ${place} 时会影响落地成本的因素，这样在计算最终数字前，运费部分会更清楚。`
    };
  }

  if (/\b(price|pricing|quote|pi|invoice|payment|deposit|total|unit price|rate)\b/i.test(lastMyMessage)) {
    const pricePart = prices ? ` with ${prices}` : '';
    return {
      en: withHumanCta(prefix, `I can put the ${object}${pricePart} into a clean recap with production and delivery timing, so the next step is easier to review.`),
      cn: `${prefix}，我可以把 ${cnObject}${pricePart ? ` 和 ${prices}` : ''} 整理成一条清楚的记录，并带上生产和交付时间，这样下一步更容易核对。`
    };
  }

  if (/\b(catalog|option|options|model|models|recommend|setup|compare|comparison)\b/i.test(lastMyMessage)) {
    // 2026-07-08: never fabricate "the models we discussed" when no concrete
    // model signal exists in this customer's own context. Without a model
    // signal, return null so the caller routes the row to manual review.
    if (!signals.models.length) return null;
    const modelPart = joinHumanList(signals.models, '');
    return {
      en: withHumanCta(prefix, `I can pull ${modelPart} into a side-by-side note with the practical differences, so you can scan it without reopening the whole catalog.`),
      cn: `${prefix}，我可以把 ${objectForChinese(modelPart)} 整理成一条并排对比说明，重点放在实际差异上，这样你不用重新打开完整目录也能快速看。`
    };
  }

  return {
    en: withHumanCta(prefix, `I can put together a simple first-step note for ${object}, so you have a clearer place to restart the conversation if it is still relevant.`),
    cn: `${prefix}，我可以先把 ${cnObject} 的第一步要点整理成一条简单说明，如果这个项目还相关，你就有一个更清楚的切入点。`
  };
}

function buildEvidenceLimitedRecoveryMessage(current, customerName) {
  if (
    boolFlag(current.hard_no_send) ||
    boolFlag(current.has_not_now_signal) ||
    boolFlag(current.is_my_turn_to_reply)
  ) {
    return null;
  }

  if (hasNoHistoryPermissionCheck(current)) {
    const name = displayNameForMessage(current, customerName);
    const prefix = name === 'Hi there' ? 'Hi there' : name;
    return {
      en: `${prefix}, are you currently working on a Pilates Reformer project? If yes, I can help with the next step here.`,
      cn: `${prefix}，你目前是否正在推进普拉提 Reformer 项目？如果是，我可以在这里协助你处理下一步。`
    };
  }

  if (hasUsableRuntimeConversationSummary(current)) {
    return buildAlternateActivationMessage(current, customerName);
  }

  return null;
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
        current.runtime_conversation_summary?.display_text,
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

    // Empty AI output normally stays blocked. The only exceptions are the two
    // evidence-limited lanes explicitly authorized by build-context.
    let usedFallback = false;
    let usedEvidenceLimitedRecovery = false;
    if (isEmptyMessage(finalMessage)) {
      const recovery = buildEvidenceLimitedRecoveryMessage(current, customerName);
      if (recovery) {
        finalMessage = recovery.en;
        finalMessageCn = recovery.cn;
        usedEvidenceLimitedRecovery = true;
      } else {
        const fallbackEn = generateFallbackMessage(customerName, current.hard_no_send);
        if (fallbackEn) {
          finalMessage = fallbackEn;
          finalMessageCn = generateFallbackMessageCn(customerName, current.hard_no_send);
          usedFallback = true;
        }
      }
    }

    const targetReply = safe(aiParsed.target_reply, '未输出');
    const hardNoSend = boolFlag(current.hard_no_send);
    const hasNotNowSignal = boolFlag(current.has_not_now_signal);
    const manualHoldReasons = getManualHoldReasons(current);

    let usedAlternateActivation = false;
    if (manualHoldReasons.length === 0 && shouldRewriteToAlternateActivation(finalMessage)) {
      const alternate = buildAlternateActivationMessage(current, customerName);
      if (alternate) {
        finalMessage = alternate.en;
        finalMessageCn = alternate.cn;
        usedAlternateActivation = true;
      } else {
        // 2026-07-08: alternate activation refused (no concrete model signal
        // or protected no-send state). Block instead of manufacturing copy.
        manualHoldReasons.push('alternate_activation_refused_no_concrete_signal');
      }
    }

    finalMessage = sanitizeCustomerGreeting(finalMessage, current, customerName);

    if (hasIncompleteChineseReference(finalMessageCn)) {
      finalMessageCn = synthesizeChineseReference(finalMessage);
    }

    let quality = assessCandidateQuality(finalMessage, current, usedFallback);
    let usedRepeatSafeRewrite = false;

    // A grounded draft that only fails because it repeats prior seller copy gets
    // one deterministic alternate-angle attempt. The replacement must pass the
    // same complete quality assessment; there is no retry loop or relaxed gate.
    if (
      manualHoldReasons.length === 0 &&
      !usedAlternateActivation &&
      hasConcreteContextAnchor(current) &&
      quality.repeatQualityHits.some(hit => ['repeat_prior_message', 'repeat_same_question'].includes(hit.name))
    ) {
      const alternate = buildAlternateActivationMessage(current, customerName);
      if (alternate) {
        const alternateMessage = sanitizeCustomerGreeting(alternate.en, current, customerName);
        const alternateChinese = hasIncompleteChineseReference(alternate.cn)
          ? synthesizeChineseReference(alternateMessage)
          : alternate.cn;
        const alternateQuality = assessCandidateQuality(alternateMessage, current, false);

        if (!alternateQuality.emptyMessage && !alternateQuality.qualityBlock) {
          finalMessage = alternateMessage;
          finalMessageCn = alternateChinese;
          quality = alternateQuality;
          usedAlternateActivation = true;
          usedRepeatSafeRewrite = true;
        }
      }
    }

    const {
      emptyMessage,
      highRisk,
      multiQuestionRisk,
      orRisk,
      decisionRisk,
      genericRisk,
      weakAnchorRisk,
      repeatQualityHits,
      bannedHits,
      qualityBlock
    } = quality;

    const missingChineseReference = hasIncompleteChineseReference(finalMessageCn);
    const qualityIssueHits = uniqueHits([
      ...bannedHits,
      ...manualHoldReasons.map(reason => ({ name: 'manual_hold', matched: reason }))
    ]);
    const shouldBlock = manualHoldReasons.length > 0 || emptyMessage || qualityBlock;

    if (shouldBlock) {
      finalMessage = '';
      finalMessageCn = '';
    }

    const multiRisk = multiQuestionRisk || orRisk ? '高' : '低';
    const thinkRisk = decisionRisk ? '高' : '低';

    const enforceStatus = manualHoldReasons.length > 0
      ? 'manual_context_required'
      : emptyMessage
        ? 'empty_skip'
        : qualityBlock
          ? 'quality_blocked'
          : usedFallback
            ? 'fallback_used'
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
      `人工上下文原因：${manualHoldReasons.length ? manualHoldReasons.join(', ') : '无'}`,
      '',
      '建议跟进话术（最终英文）：',
      finalMessage ? `✅ ${finalMessage}` : '⛔ 空消息，不发送',
      '',
      '建议跟进话术（中文对照）：',
      finalMessageCn ? `✅ ${finalMessageCn}` : '⛔ 未提供中文对照'
    ].join('\n'), 3500);

    const headerParts = [];
    if (manualHoldReasons.length > 0) {
      headerParts.push(`⛔ MANUAL_CONTEXT_REQUIRED ⛔\n原因: ${manualHoldReasons.join(', ')}\n不输出客户可发话术。请人工核对最新对话、身份和阶段后再决定。`);
    } else if (hardNoSend || hasNotNowSignal) {
      headerParts.push('⛔ HARD_NO_SEND ⛔\n客户曾发出"暂时不要联系"信号,默认不发,如确实要发请人工 review 客户最新消息后再决定。');
    }
    if (bannedHits.length > 0) {
      headerParts.push(`⚠️ BANNED_PHRASE_DETECTED ⚠️\nMatched: "${bannedHits.map(h => h.matched).join('" / "')}"\n请在 Telegram 审核时手动改写后再发送。`);
    } else if (missingChineseReference) {
      headerParts.push('⚠️ MISSING_COMPLETE_CN_TRANSLATION ⚠️\n缺少完整中文翻译；英文客户可复制文案仍保留，避免浪费本次 AI 结果。发送客户前请先人工核对/补中文。');
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
      banned_phrase_flagged: bannedHits.length > 0,
      banned_phrase_hits: bannedHits,
      // 2026-07-08: include manual hold reasons as structured entries so
      // blocked rows are operable (missing_summary / weak_identity /
      // missing_customer_context ...) instead of a bare empty_message.
      banned_phrase_details: JSON.stringify(qualityIssueHits),
      quality_issue_hits: qualityIssueHits,
      missing_chinese_reference: missingChineseReference,
      manual_hold_reasons: manualHoldReasons,
      used_alternate_activation: usedAlternateActivation,
      used_repeat_safe_rewrite: usedRepeatSafeRewrite,
      used_evidence_limited_recovery: usedEvidenceLimitedRecovery,
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
