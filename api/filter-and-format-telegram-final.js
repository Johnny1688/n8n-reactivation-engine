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
  { name: 'at_your_convenience', regex: /at\s+your\s+convenience/i }
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
    'shipping'
  ];

  return !anchorPatterns.some(p => text.includes(p));
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

    const finalMessage = safe(enforceParsed.whatsapp_message, '');

    const finalMessageCn = safe(
      pick(
        enforceParsed.whatsapp_message_cn,
        current.whatsapp_message_cn,
        aiParsed.whatsapp_message_cn,
        current._cn
      ),
      ''
    );

    const targetReply = safe(aiParsed.target_reply, '未输出');

    const emptyMessage = isEmptyMessage(finalMessage);
    const highRisk = hasHighRiskPattern(finalMessage);
    const multiQuestionRisk = hasTooManyQuestions(finalMessage);
    const orRisk = hasOrRisk(finalMessage);
    const decisionRisk = hasDecisionRisk(finalMessage);
    const genericRisk = hasGenericRisk(finalMessage);
    const weakAnchorRisk = hasWeakAnchorRisk(finalMessage);

    const shouldBlock = emptyMessage;

    const multiRisk = multiQuestionRisk || orRisk ? '高' : '低';
    const thinkRisk = decisionRisk ? '高' : '低';

    const enforceStatus = emptyMessage
      ? 'empty_skip'
      : shouldBlock
        ? 'blocked'
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
      '',
      '建议跟进话术（最终英文）：',
      finalMessage ? `✅ ${finalMessage}` : '⛔ 空消息，不发送',
      '',
      '建议跟进话术（中文对照）：',
      finalMessageCn ? `✅ ${finalMessageCn}` : '⛔ 未提供中文对照'
    ].join('\n'), 3500);

    const bannedHits = detectBannedPhrases(finalMessage);

    const reviewHeader = bannedHits.length > 0
      ? `⚠️ BANNED_PHRASE_DETECTED ⚠️\nMatched: "${bannedHits.map(h => h.matched).join('" / "')}"\n请在 Telegram 审核时手动改写后再发送。\n\n`
      : '';

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
      banned_phrase_hits: bannedHits
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
