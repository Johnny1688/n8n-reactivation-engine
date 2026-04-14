const {
  cleanAndDedup,
  cleanText,
  normalizeUnknown,
  uniqueNonEmpty
} = require('./cleanAndDedup.js');
const {
  buildTimeline,
  formatDateDisplay
} = require('./buildTimeline.js');
const { analyzeStopPoint } = require('./analyzeStopPoint.js');
const { detectForbiddenRepeats } = require('./detectForbiddenRepeats.js');
const { buildReactivationDecisionBasis } = require('./buildReactivationDecisionBasis.js');
const { buildReactivationV6Core } = require('./buildReactivationV6Core.js');
const { buildReactivationAIPayload } = require('./buildReactivationAIPayload.js');

function buildAIContext(input) {
  const CONTEXT_BUILDER_VERSION = "build_ai_context_v5.1_PRODUCTION_READY";

  // =========================
  // 0) 输入预处理
  // =========================
  const rawInput = input || {};
  input = { ...rawInput };

  delete input.recent_conversation;

  const {
    parsedMessages,
    uniqueMessages
  } = cleanAndDedup(input);

  // =========================
  // 7) 分层上下文
  // =========================
  const recentMessages = uniqueMessages.slice(-10);
  const coreMessages = uniqueMessages.slice(-20);

  const cleanedFullConversation = uniqueMessages
    .map(m => `${m.role}: ${m.message}`)
    .join('\n');

  const conversation = recentMessages
    .map(m => `${m.role}: ${m.message}`)
    .join('\n');

  const conversationCore = coreMessages
    .map(m => `${m.role}: ${m.message}`)
    .join('\n');

  // =========================
  // 8) 客户优先文本源
  // =========================
  const customerMessages = uniqueMessages.filter(m => m.role === 'customer');
  const myMessages = uniqueMessages.filter(m => m.role === 'me');

  const customerOnlyText = customerMessages.map(m => m.message).join('\n');
  const customerRecentOnlyText = customerMessages.slice(-8).map(m => m.message).join('\n');
  const sellerOnlyText = myMessages.map(m => m.message).join('\n');

  const projectAndStructuredText = [
    input.project_key || '',
    input.customer_name || '',
    normalizeUnknown(input.customer_type),
    normalizeUnknown(input.intent_level),
    normalizeUnknown(input.purchase_stage),
    normalizeUnknown(input.product_interest),
    normalizeUnknown(input.quantity_signal),
    normalizeUnknown(input.concerns),
    normalizeUnknown(input.key_signals)
  ].join('\n');

  const customerPriorityAnalysisText = [
    customerOnlyText,
    customerRecentOnlyText,
    projectAndStructuredText
  ].join('\n');

  const {
    firstMessageObj,
    lastMessageObj,
    lastCustomerMessageObj,
    lastMyMessageObj,
    nowTime,
    firstMessageTime,
    lastCustomerTime,
    lastMyTime,
    lastMessageTime,
    lastCustomerTimeObj,
    lastMyTimeObj,
    lastCustomerGapHint,
    whoStopped,
    whoShouldReplyNext,
    timelineSequence,
    timelineConversationStatus,
    gapDaysCustomerVsMe,
    gapHoursCustomerVsMe,
    gapMinutesCustomerVsMe,
    hoursSinceLastCustomerMessage,
    hoursSinceLastMyMessage,
    daysSinceLastCustomerMessage,
    daysSinceLastMyMessage,
    timelineEvents,
    datedHistorySummary,
    timelineSummary,
    timeline
  } = buildTimeline(input, uniqueMessages);

  // =========================
  // 11) 当前轮次判断
  // =========================
  const lastMessageRole = lastMessageObj?.role || '';

  const isMyTurnToReply =
    uniqueMessages.length === 0 ? null : lastMessageRole === 'customer';

  const customerRepliedAfterMyLastMessage =
    !!(lastCustomerTimeObj && lastMyTimeObj && lastCustomerTimeObj > lastMyTimeObj);

  const isCustomerSilentAfterMyMessage =
    uniqueMessages.length === 0
      ? null
      : !!(lastMyTimeObj && (!lastCustomerTimeObj || lastMyTimeObj >= lastCustomerTimeObj));

  // =========================
  // 12) 基础统计
  // =========================
  const customerMessageCount = customerMessages.length;
  const myMessageCount = myMessages.length;

  const fullTextLower = cleanedFullConversation.toLowerCase();
  const customerOnlyLower = customerOnlyText.toLowerCase();

  const hasPriceSignal =
    /\b(price|cost|quote|quoted|cheaper|expensive|budget|shipping|tariff|freight|full amount|lock price|secure price|hold price|deposit|invoice|pi|payment plan|payment plans|sample prices?|how much)\b/.test(customerOnlyLower || fullTextLower);

  const hasTimingSignal =
    /\b(october|late fall|this fall|early september|late august|timeline|shipment|delivery|lead time|transit time|arrive|check back|opening|open in|late october|target month)\b/.test(customerOnlyLower || fullTextLower);

  const hasNotNowSignal =
    /not looking.*right now|not currently looking|not ready.*right now|not ready yet|maybe later|i['’]ll let you know|i will let you know|not now|not at the moment/.test(customerOnlyLower || fullTextLower);

  const hasReply = customerMessageCount > 0;
  const isNotNowCustomer = hasNotNowSignal === true;

  // =========================
  // 13) 最后一句类型判断
  // =========================
  function classifyCustomerLastMessage(text) {
    const t = cleanText(text || '').toLowerCase();

    if (!t) return 'unknown';

    if (/not looking.*right now|not currently looking|not ready.*right now|not ready yet|maybe later|i['’]ll let you know|i will let you know|not now|not at the moment/.test(t)) {
      return 'not_now';
    }

    if (/\b(october|late fall|this fall|early september|late august|target month|opening)\b/.test(t)) {
      return 'timing_delay';
    }

    if (/\b(cheaper|found them cheaper|too expensive|expensive|budget)\b/.test(t)) {
      return 'comparison_signal';
    }

    if (/\b(price|cost|how much|quote)\b/.test(t)) {
      return 'price_reaction_soft';
    }

    if (/^(ah ok|ok|okay|thanks|thank you|got it|alright)\b/.test(t) || /\b(ah ok|okay thanks|thanks|thank you)\b/.test(t)) {
      return 'polite_close';
    }

    if (/\?$/.test(t) || /\b(how|what|when|which|can|do you|is there|are there)\b/.test(t)) {
      return 'question';
    }

    if (/\b(yes|sounds good|perfect|great|confirm|yes please)\b/.test(t)) {
      return 'confirmation';
    }

    if (t.length <= 20) return 'interest_no_action';

    return 'unknown';
  }

  const customerLastMessageType = classifyCustomerLastMessage(
    lastCustomerMessageObj?.message || ''
  );

  // =========================
  // 14) 最近一轮交换
  // =========================
  const lastExchange = {
    last_customer_message: lastCustomerMessageObj?.message || '',
    last_customer_message_time: lastCustomerTime || '',
    last_customer_message_time_display: formatDateDisplay(lastCustomerTime || ''),
    last_my_message: lastMyMessageObj?.message || '',
    last_my_message_time: lastMyTime || '',
    last_my_message_time_display: formatDateDisplay(lastMyTime || ''),
    last_message_role: lastMessageRole || 'unknown',
    sequence: timelineSequence,
    who_stopped: whoStopped,
    who_should_reply_next: whoShouldReplyNext
  };

  // =========================
  // 15) 产品识别
  // =========================
  function detectProductInterest(text) {
    const t = (text || '').toLowerCase();
    const hits = [];

    const rules = [
      { pattern: /\bar011\b/g, value: 'AR011' },
      { pattern: /\bar010\b/g, value: 'AR010' },
      { pattern: /\bar003\b/g, value: 'AR003' },
      { pattern: /\bar001\b/g, value: 'AR001' },
      { pattern: /\bmr001\b/g, value: 'MR001' },
      { pattern: /\bmr002\b/g, value: 'MR002' },
      { pattern: /\bmr003\b/g, value: 'MR003' },
      { pattern: /\bor001\b/g, value: 'OR001' },
      { pattern: /\bfr001\b/g, value: 'FR001' },
      { pattern: /\bfr004\b/g, value: 'FR004' },
      { pattern: /\bpr007\b/g, value: 'PR007' },
      { pattern: /\bmg001\b/g, value: 'MG001' },
      { pattern: /\bmg002\b/g, value: 'MG002' },
      { pattern: /\bmg003\b/g, value: 'MG003' },
      { pattern: /\bmg004\b/g, value: 'MG004' },
      { pattern: /\bmg005\b/g, value: 'MG005' },
      { pattern: /\bmg006\b/g, value: 'MG006' },
      { pattern: /\bmegaformer\b/g, value: 'Megaformer' },
      { pattern: /\blagree\b/g, value: 'Megaformer' },
      { pattern: /\bfolding reformer\b/g, value: 'Folding Reformer' },
      { pattern: /\bfoldable\b/g, value: 'Folding Reformer' },
      { pattern: /\baluminum reformer\b/g, value: 'Aluminum Reformer' },
      { pattern: /\baluminium reformer\b/g, value: 'Aluminum Reformer' },
      { pattern: /\bwood reformer\b/g, value: 'Wood Reformer' },
      { pattern: /\bwooden reformer\b/g, value: 'Wood Reformer' },
      { pattern: /\breformer with tower\b/g, value: 'Reformer with Tower' },
      { pattern: /\b3-in-1\b/g, value: '3-in-1 Reformer' },
      { pattern: /\bcadillac\b/g, value: 'Cadillac' },
      { pattern: /\bchair\b/g, value: 'Chair' },
      { pattern: /\btower\b/g, value: 'Tower' },
      { pattern: /\bbarrel\b/g, value: 'Barrel' },
      { pattern: /\battachments?\b/g, value: 'Attachments' },
      { pattern: /\baccessories\b/g, value: 'Accessories' },
      { pattern: /\breformer\b/g, value: 'Reformer' }
    ];

    for (const rule of rules) {
      if (rule.pattern.test(t)) hits.push(rule.value);
    }

    let uniqueHits = uniqueNonEmpty(hits);

    if (/\bno tower\b|\bwith no tower\b/.test(t)) {
      uniqueHits = uniqueHits.filter(x => x !== 'Tower' && x !== 'Reformer with Tower');
    }

    if (uniqueHits.includes('AR011')) {
      uniqueHits = uniqueHits.filter(x => x !== 'Reformer');
    }

    return uniqueHits.join(', ') || 'unknown';
  }

  // =========================
  // 16) 数量识别
  // =========================
  function detectQuantitySignal(text) {
    if (isNotNowCustomer) return 'unknown';

    const t = (text || '')
      .toLowerCase()
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{1,2,4}\b/g, ' ')
      .replace(/\b\d{1,2}\s*(days?|day|hours?|hrs?|weeks?|months?)\b/g, ' ')
      .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
      .replace(/\bar\d{3}\b/g, ' ')
      .replace(/\bmr\d{3}\b/g, ' ')
      .replace(/\bor\d{3}\b/g, ' ')
      .replace(/\bfr\d{3}\b/g, ' ')
      .replace(/\bmg\d{3}\b/g, ' ');

    const rangeWithUnitMatch = t.match(/\b(\d{1,2})\s*(?:-|~|to|or)\s*(\d{1,2})\s*(units|pcs|pieces|machines|beds|reformers?)\b/);
    if (rangeWithUnitMatch) {
      const a = Number(rangeWithUnitMatch[1]);
      const b = Number(rangeWithUnitMatch[2]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        return `${Math.min(a, b)}-${Math.max(a, b)}`;
      }
    }

    const qtyUnitMatch = t.match(/\b(\d{1,2})\s*(units|pcs|pieces|machines|beds|reformers?)\b/);
    if (qtyUnitMatch) return qtyUnitMatch[1];

    const directNeedMatch = t.match(/\bneed\s*(\d{1,2})\b|\bwant\s*(\d{1,2})\b|\blooking for\s*(\d{1,2})\b|\bplan(?:ning)?\s*(\d{1,2})\b/);
    if (directNeedMatch) {
      return directNeedMatch[1] || directNeedMatch[2] || directNeedMatch[3] || directNeedMatch[4] || 'unknown';
    }

    const bareOrPattern = t.match(/\b(\d{1,2})\s*(?:or)\s*(\d{1,2})\b/);
    if (bareOrPattern && /\breformer|machines?|units?|beds?|sample\b/.test(t)) {
      const a = Number(bareOrPattern[1]);
      const b = Number(bareOrPattern[2]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        return `${Math.min(a, b)}-${Math.max(a, b)}`;
      }
    }

    if (/\bone sample\b|\bfor one sample\b|\bsample first\b/.test(t)) return '1';

    const projectKeyRange = String(input.project_key || '').match(/\b(\d{1,2})\s*[-~to]+\s*(\d{1,2})\s*(台|units?|pcs|reformers?)\b/i);
    if (projectKeyRange) {
      const a = Number(projectKeyRange[1]);
      const b = Number(projectKeyRange[2]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        return `${Math.min(a, b)}-${Math.max(a, b)}`;
      }
    }

    const projectKeyQty = String(input.project_key || '').match(/\b(\d{1,2})\s*(台|units?|pcs|reformers?)\b/i);
    if (projectKeyQty) return projectKeyQty[1];

    return 'unknown';
  }

  // =========================
  // 17) customer_type
  // =========================
  function detectCustomerType(text) {
    const t = (text || '').toLowerCase();

    if (/\bdistributor|dealer|reseller|wholesale|sell on my website|ecommerce|amazon|retail|distribution\b/.test(t)) {
      return 'distributor_or_reseller';
    }

    if (/\bhome use|for home|personal use|my house|my home\b/.test(t)) {
      return 'end_user';
    }

    if (/\bgym|fitness club|wellness center|clinic|rehab\b/.test(t)) {
      return 'commercial_facility';
    }

    if (/\bstudio|open a studio|opening a studio|new studio|pilates studio|for my studio|studio setup\b/.test(t)) {
      return 'studio_owner';
    }

    if (/\bmassage therapist\b/.test(t)) {
      return 'individual_practitioner';
    }

    if (/\bcommercial studio use\b/.test(t)) {
      return 'commercial_buyer';
    }

    return 'unknown';
  }

  // =========================
  // 18) 意向等级
  // =========================
  function detectIntentLevel(text) {
    const t = (text || '').toLowerCase();

    const strongSignals = [
      /\bprice\b/,
      /\bquote\b/,
      /\bshipping\b/,
      /\bfreight\b/,
      /\blead time\b/,
      /\bdelivery\b/,
      /\bhow much\b/,
      /\bpayment\b/,
      /\bdeposit\b/,
      /\block price\b/,
      /\bsecure price\b/,
      /\bhold price\b/,
      /\bplace order\b/,
      /\bpi\b/,
      /\binvoice\b/,
      /\bwarranty\b/,
      /\bpayment plans?\b/,
      /\bzip code\b/,
      /\bhouston\b/,
      /\btexas\b/
    ];

    const mediumSignals = [
      /\bmodel\b/,
      /\bspec\b/,
      /\bsize\b/,
      /\bvideo\b/,
      /\bphoto\b/,
      /\bcatalog\b/,
      /\bwhich one\b/,
      /\bcompare\b/,
      /\bsample\b/,
      /\battachments?\b/,
      /\baccessories\b/
    ];

    let strong = 0;
    let medium = 0;

    for (const r of strongSignals) if (r.test(t)) strong++;
    for (const r of mediumSignals) if (r.test(t)) medium++;

    if (strong >= 3) return 'high';
    if (strong >= 1 || medium >= 2) return 'medium';
    if (medium >= 1) return 'low';
    return 'unknown';
  }

  // =========================
  // 19) 采购阶段
  // =========================
  function detectPurchaseStage(text) {
    const t = (text || '').toLowerCase();

    if (/\bpi\b|\binvoice\b|\bdeposit\b|\bplace order\b|\border now\b|\bconfirm order\b/.test(t)) {
      return 'closing';
    }

    if (/\bshipping\b|\bfreight\b|\bcost\b|\bquote\b|\bprice\b|\block price\b|\bsecure price\b|\bwarranty\b|\bpayment plans?\b|\bhow much\b/.test(t)) {
      return 'pricing';
    }

    if (/\bmodel\b|\bwhich one\b|\bcompare\b|\baluminum\b|\baluminium\b|\bwood\b|\bfolding\b|\bwith no tower\b|\bno tower\b/.test(t)) {
      return 'selection';
    }

    if (/\bcatalog\b|\bphoto\b|\bvideo\b|\bdetails\b|\bspec\b|\boptions\b/.test(t)) {
      return 'information_gathering';
    }

    return 'unknown';
  }

  // =========================
  // 20) 关注点
  // =========================
  function detectConcerns(text) {
    const t = (text || '').toLowerCase();
    const concerns = [];

    if (/\bprice\b|\bcost\b|\bbudget\b|\bexpensive\b|\bcheaper\b|\bsample price|how much\b/.test(t)) concerns.push('price');
    if (/\bshipping\b|\bfreight\b|\bdelivery\b|\btransit\b|\btariff\b|\bddp\b|\bzip code\b/.test(t)) concerns.push('shipping');
    if (/\blead time\b|\btimeline\b|\boctober\b|\baugust\b|\bseptember\b|\bfall\b|\bopening\b|\blate fall\b/.test(t)) concerns.push('timeline');
    if (/\bwarranty\b|\bmaintenance\b|\bafter-sales\b|\bafter sales\b/.test(t)) concerns.push('after_sales');
    if (/\bsize\b|\bdimension\b|\bheight\b|\bspace\b|\bfoldable\b/.test(t)) concerns.push('specs');
    if (/\bpayment plan\b|\bpayment plans\b|\bdeposit\b|\b30%\b|\b70%\b/.test(t)) concerns.push('payment_terms');
    if (/\battachments?\b|\baccessories\b/.test(t)) concerns.push('accessories');

    return concerns.length ? uniqueNonEmpty(concerns).join(', ') : 'unknown';
  }

  // =========================
  // 21) 关键信号
  // =========================
  function detectKeySignals(text) {
    const t = cleanText(text || '');
    const signals = [];

    if (/october|late october|late fall|opening/i.test(t)) signals.push('明确时间规划');
    if (/lock price|secure price|hold price/i.test(t)) signals.push('有锁价意识');
    if (/shipping|delivery|lead time|ddp/i.test(t)) signals.push('关注交付节奏');
    if (/price|quote|cost|sample price|cheaper|how much/i.test(t)) signals.push('价格敏感');
    if (/studio|commercial|new studio/i.test(t)) signals.push('偏B端/商用场景');
    if (/warranty|payment plan|deposit/i.test(t)) signals.push('已进入实质采购问题');

    return signals.length ? uniqueNonEmpty(signals).join('；') : 'unknown';
  }

  // =========================
  // 22) 派生业务字段
  // =========================
  const derivedCustomerTypeRaw =
    normalizeUnknown(input.customer_type) ||
    detectCustomerType(`${customerOnlyText}\n${projectAndStructuredText}`);

  const derivedIntentLevelRaw =
    normalizeUnknown(input.intent_level) ||
    detectIntentLevel(`${customerOnlyText}\n${projectAndStructuredText}`);

  const derivedPurchaseStageRaw =
    normalizeUnknown(input.purchase_stage) ||
    detectPurchaseStage(`${customerOnlyText}\n${projectAndStructuredText}`);

  const derivedProductInterestRaw =
    normalizeUnknown(input.product_interest) ||
    detectProductInterest(customerOnlyText);

  const derivedQuantitySignalRaw =
    normalizeUnknown(input.quantity_signal) ||
    detectQuantitySignal(`${customerOnlyText}\n${input.project_key || ''}`);

  const derivedConcernsRaw =
    normalizeUnknown(input.concerns) ||
    detectConcerns(`${customerOnlyText}\n${projectAndStructuredText}`);

  const derivedKeySignalsRaw =
    normalizeUnknown(input.key_signals) ||
    detectKeySignals(`${customerOnlyText}\n${projectAndStructuredText}\n${timelineSummary}`);

  // =========================
  // 23) 关键兜底
  // =========================
  function enforceMinimumSignals() {
    let customerType = derivedCustomerTypeRaw;
    let intentLevel = derivedIntentLevelRaw;
    let purchaseStage = derivedPurchaseStageRaw;
    let concerns = derivedConcernsRaw;
    let keySignals = derivedKeySignalsRaw;
    let productInterest = derivedProductInterestRaw;
    let quantitySignal = derivedQuantitySignalRaw;

    const text = customerOnlyText.toLowerCase();
    const projectText = String(input.project_key || '').toLowerCase();

    if (customerType === 'unknown') {
      if (/\bstudio\b/.test(text) || /\bstudio\b/.test(projectText)) customerType = 'studio_owner';
      else if (/\bcommercial studio use\b/.test(text)) customerType = 'commercial_buyer';
    }

    if (intentLevel === 'unknown') {
      if (customerMessageCount > 0) {
        intentLevel = hasPriceSignal || hasTimingSignal ? 'low' : 'low';
      } else if (myMessageCount > 0) {
        intentLevel = 'low';
      }
    }

    if (purchaseStage === 'unknown' && /\bprice|how much|cost|quote|quoted|cheaper\b/.test(text)) {
      purchaseStage = 'pricing';
    }
    if (purchaseStage === 'unknown' && /\bcatalog|models?|which pilates reformer|details|info\b/.test(text)) {
      purchaseStage = 'information_gathering';
    }
    if (purchaseStage === 'unknown' && customerMessageCount > 0) {
      purchaseStage = 'information_gathering';
    }
    if (purchaseStage === 'unknown' && myMessageCount > 0 && customerMessageCount === 0) {
      purchaseStage = 'information_gathering';
    }
    if (purchaseStage === 'unknown' && customerMessageCount === 0 && myMessageCount === 0) {
      purchaseStage = 'information_gathering';
    }

    if (concerns === 'unknown' && /\bprice|how much|cost|budget|cheaper\b/.test(text)) {
      concerns = 'price';
    }
    if (concerns === 'unknown' && /\bwarranty\b/.test(text)) {
      concerns = 'after_sales';
    }
    if (concerns === 'unknown' && /\bpayment plan|payment plans\b/.test(text)) {
      concerns = 'payment_terms';
    }
    if (concerns === 'unknown' && /\boctober|fall|late fall|opening\b/.test(text)) {
      concerns = 'timeline';
    }
    if (concerns === 'unknown' && /\battachments?\b|\baccessories\b/.test(text)) {
      concerns = 'accessories';
    }

    if (productInterest === 'unknown' && /\breformer\b/.test(text)) {
      productInterest = 'Reformer';
    }
    if (productInterest === 'unknown' && /which pilates reformer models/i.test(customerOnlyText)) {
      productInterest = 'Reformer';
    }
    if (productInterest === 'unknown' && /\battachments?\b/.test(text)) {
      productInterest = 'Attachments';
    }

    if (productInterest === 'unknown' && customerMessageCount === 0 && myMessageCount > 0) {
      if (/\breformer\b/i.test(sellerOnlyText) || /\bfr\d{3}\b|\bar\d{3}\b|\bmr\d{3}\b/i.test(projectText)) {
        productInterest = 'Reformer';
      }
    }

    if (keySignals === 'unknown') {
      const signals = [];
      if (/\bprice|how much|cheaper\b/.test(text)) signals.push('价格敏感');
      if (/\bwarranty|payment plan|zip code\b/.test(text)) signals.push('已进入实质采购问题');
      if (/\boctober|late fall|opening\b/.test(text)) signals.push('明确时间规划');
      if (/\bstudio|commercial|new studio\b/.test(text) || /\bstudio\b/.test(projectText)) signals.push('偏B端/商用场景');

      if (signals.length) {
        keySignals = uniqueNonEmpty(signals).join('；');
      } else if (customerMessageCount > 0) {
        keySignals = '已有初步互动；客户信号较弱';
      } else if (myMessageCount > 0) {
        keySignals = '仅有我方触达记录；等待客户回应';
      } else {
        keySignals = '暂无有效互动记录';
      }
    }

    if (isNotNowCustomer) {
      quantitySignal = 'unknown';
      concerns = 'unknown';
      keySignals = keySignals === 'unknown' ? '当前暂无采购计划' : keySignals;
    }

    return {
      customerType,
      intentLevel,
      purchaseStage,
      concerns,
      keySignals,
      productInterest,
      quantitySignal
    };
  }

  const enforcedSignals = enforceMinimumSignals();

  const finalCustomerType = enforcedSignals.customerType;
  const finalIntentLevel = enforcedSignals.intentLevel;
  const finalPurchaseStage = enforcedSignals.purchaseStage;
  const finalConcerns = enforcedSignals.concerns;
  const finalKeySignals = enforcedSignals.keySignals;
  const finalProductInterest = enforcedSignals.productInterest;
  const finalQuantitySignal = enforcedSignals.quantitySignal;

  // =========================
  // 24) stage / priority / status
  // =========================
  function deriveStage() {
    const existing = normalizeUnknown(input.stage);
    if (existing) return existing;

    if (uniqueMessages.length === 0) return 'outreach';

    if (finalPurchaseStage === 'closing') return 'ready';
    if (finalPurchaseStage === 'pricing') return 'price';
    if (finalPurchaseStage === 'selection') return 'evaluating';
    if (finalPurchaseStage === 'information_gathering') return 'engaged';

    if (hasReply) return 'engaged';
    return 'outreach';
  }

  function derivePriority() {
    const existing = normalizeUnknown(input.follow_up_priority);
    if (existing) return existing;

    if (hasNotNowSignal) return 'low';
    if (finalIntentLevel === 'high' && hasTimingSignal) return 'high';
    if (finalIntentLevel === 'high') return 'high';
    if (finalIntentLevel === 'medium') return 'medium';
    if (finalIntentLevel === 'low') return 'low';

    return 'low';
  }

  function deriveStatus() {
    const existing = normalizeUnknown(input.status);
    if (existing) return existing;

    if (uniqueMessages.length === 0) return 'open';
    if (isMyTurnToReply === true) return 'waiting_for_me';
    if (isCustomerSilentAfterMyMessage === true) return 'waiting_for_customer';
    return 'open';
  }

  const derivedStage = deriveStage();
  const derivedPriority = derivePriority();
  const derivedStatus = deriveStatus();

  // =========================
  // 25) reactivation 判断（拆字段后）
  // =========================
  let shouldReactivateNow = false;

  if (uniqueMessages.length === 0) {
    shouldReactivateNow = false;
  } else if (whoShouldReplyNext === 'customer') {
    if (hasNotNowSignal) {
      shouldReactivateNow = false;
    } else if (hoursSinceLastMyMessage == null) {
      shouldReactivateNow = false;
    } else if (hoursSinceLastMyMessage < 24) {
      shouldReactivateNow = false;
    } else if (customerMessageCount === 0 && hoursSinceLastMyMessage < 72) {
      shouldReactivateNow = false;
    } else {
      shouldReactivateNow = true;
    }
  } else {
    shouldReactivateNow = false;
  }

  // =========================
  // 26) 当前判断字段
  // =========================
  function deriveCurrentBlocker() {
    if (hasNotNowSignal) return '客户暂未进入采购窗口';
    if (finalPurchaseStage === 'pricing' && isCustomerSilentAfterMyMessage) return '报价后暂未继续推进';
    if (finalPurchaseStage === 'selection') return '型号尚未最终收敛';
    if (hasTimingSignal) return '客户有明确时间点，但尚未进入明确落单动作';
    if (!hasReply && myMessageCount > 0) return '客户尚未回复我方最近消息';
    return '缺少明确下一步动作';
  }

  function deriveStrategyDirection() {
    if (hasNotNowSignal) return '轻保持联系';
    if (finalPurchaseStage === 'closing') return '推进成交';
    if (finalPurchaseStage === 'pricing') return '轻推进报价确认';
    if (hasTimingSignal) return '围绕时间点重新激活';
    if (!hasReply && myMessageCount > 0) return '首次重新激活';
    return '轻重新开启';
  }

  function deriveReplyAngle() {
    if (hasTimingSignal) return '围绕客户之前提到的时间安排切入';
    if (finalPurchaseStage === 'pricing') return '围绕价格确认或落单条件切入';
    if (finalPurchaseStage === 'selection') return '围绕型号匹配和选择确认切入';
    if (!hasReply && myMessageCount > 0) return '低压力重新开启对话';
    return '轻提醒并降低回复压力';
  }

  function deriveFollowUpFocus() {
    if (isNotNowCustomer) {
      return '保持轻联系，不提具体产品';
    }

    const focus = [];

    if (finalProductInterest !== 'unknown') focus.push(`提及${finalProductInterest}`);
    if (finalQuantitySignal !== 'unknown') focus.push(`提及数量信号${finalQuantitySignal}`);
    if (hasTimingSignal) focus.push('提及时间安排');
    if (/lock price|secure price|hold price/i.test(customerOnlyText)) focus.push('提及锁价');
    if (finalConcerns !== 'unknown') focus.push(`围绕${finalConcerns}`);

    return focus.length ? focus.join('；') : '轻量重启对话';
  }

  const currentBlocker = deriveCurrentBlocker();
  const strategyDirection = deriveStrategyDirection();
  const replyAngle = deriveReplyAngle();
  const followUpFocus = deriveFollowUpFocus();

  // =========================
  // 27) 单锚点执行字段
  // =========================
  function derivePrimaryReplyAnchor() {
    if (hasNotNowSignal) return 'not_now';
    if (customerLastMessageType === 'comparison_signal') return 'price_comparison';
    if (customerLastMessageType === 'timing_delay' || hasTimingSignal) return 'timing';
    if (customerLastMessageType === 'price_reaction_soft' || finalPurchaseStage === 'pricing') return 'price';
    if (finalPurchaseStage === 'selection') return 'selection';
    if (customerLastMessageType === 'question') return 'question_response';
    if (finalProductInterest !== 'unknown') return 'product_interest';
    return 'soft_reopen';
  }

  function deriveSecondaryContext() {
    const parts = [];
    if (finalProductInterest !== 'unknown') parts.push(finalProductInterest);
    if (finalQuantitySignal !== 'unknown') parts.push(`qty:${finalQuantitySignal}`);
    if (finalConcerns !== 'unknown') parts.push(finalConcerns);
    return parts.join(' | ') || '';
  }

  function deriveReplyRisk() {
    if (hasNotNowSignal) return 'do_not_push';
    if (customerLastMessageType === 'comparison_signal') return 'avoid_price_pressure';
    if (customerLastMessageType === 'polite_close') return 'do_not_double_ping';
    if (whoShouldReplyNext === 'customer' && hoursSinceLastMyMessage != null && hoursSinceLastMyMessage < 24) {
      return 'too_soon';
    }
    if (finalPurchaseStage === 'pricing') return 'avoid_pressure';
    return 'normal';
  }

  const primaryReplyAnchor = derivePrimaryReplyAnchor();
  const secondaryContext = deriveSecondaryContext();
  const replyRisk = deriveReplyRisk();

  // =========================
  // 28) 客户名称兜底
  // =========================
  function deriveCustomerName() {
    const existing = normalizeUnknown(input.customer_name);
    if (existing) return existing;

    const pk = String(input.project_key || '').trim();
    if (!pk) return '未知客户';

    return pk;
  }

  const derivedCustomerName = deriveCustomerName();

  // =========================
  // 29) 项目名称补强识别
  // =========================
  function deriveProjectSignalsFromProjectKey() {
    const signals = {
      project_has_stage_hint: false,
      project_has_qty_hint: false,
      project_has_model_hint: false
    };

    if (/\bready|price|evaluating|engaged|outreach\b/i.test(input.project_key || '')) {
      signals.project_has_stage_hint = true;
    }
    if (/\b\d{1,2}\s*(台|units?|pcs|reformers?)\b/i.test(input.project_key || '')) {
      signals.project_has_qty_hint = true;
    }
    if (/\b[a-z]{2}\d{3}\b/i.test(input.project_key || '')) {
      signals.project_has_model_hint = true;
    }

    return signals;
  }

  const projectSignals = deriveProjectSignalsFromProjectKey();
  const stopPointAnalysis = analyzeStopPoint({
    messages: uniqueMessages,
    lastCustomerMessageObj,
    lastMyMessageObj,
    customerLastMessageType,
    finalPurchaseStage,
    hasTimingSignal,
    hasNotNowSignal
  });
  const forbiddenRepeatZone = detectForbiddenRepeats({
    messages: uniqueMessages
  });
  const reactivationDecisionBasis = buildReactivationDecisionBasis({
    shouldReactivateNow,
    stopPointAnalysis,
    forbiddenRepeatZone,
    customerLastMessageType,
    finalPurchaseStage,
    hasTimingSignal,
    hasNotNowSignal
  });
  const reactivationV6Core = buildReactivationV6Core({
    timeline,
    lastExchange,
    customerLastMessageType,
    currentBlocker,
    stopPointAnalysis,
    forbiddenRepeatZone,
    reactivationDecisionBasis
  });
  const aiPayload = buildReactivationAIPayload({
    reactivationV6Core
  });

  // =========================
  // 30) 输出
  // =========================
  return {
    ...input,

    _context_builder_version: CONTEXT_BUILDER_VERSION,

    messages: uniqueMessages,
    recent_messages: recentMessages,
    core_messages: coreMessages,

    cleaned_full_conversation: cleanedFullConversation,
    conversation,
    conversation_core: conversationCore,

    customer_only_text: customerOnlyText,
    customer_recent_only_text: customerRecentOnlyText,
    seller_only_text: sellerOnlyText,
    project_and_structured_text: projectAndStructuredText,
    customer_priority_analysis_text: customerPriorityAnalysisText,

    project_key: input.project_key || '',
    customer_name: derivedCustomerName,

    now_time: nowTime,
    now_time_display: formatDateDisplay(nowTime),

    first_message: firstMessageObj?.message || '',
    first_message_time: firstMessageTime,
    first_message_time_display: formatDateDisplay(firstMessageTime || ''),

    last_customer_message: lastCustomerMessageObj?.message || input.last_customer_message || '',
    last_customer_message_time: lastCustomerTime,
    last_customer_message_time_display: formatDateDisplay(lastCustomerTime || ''),

    last_my_message: lastMyMessageObj?.message || input.last_my_message || '',
    last_my_message_time: lastMyTime,
    last_my_message_time_display: formatDateDisplay(lastMyTime || ''),

    last_message_time: lastMessageTime,
    last_message_time_display: formatDateDisplay(lastMessageTime || ''),
    last_message_role: lastMessageRole || '',

    timeline,
    timeline_summary: timelineSummary,
    dated_history_summary: datedHistorySummary,
    timeline_events: timelineEvents,
    who_stopped: whoStopped,
    who_should_reply_next: whoShouldReplyNext,
    conversation_sequence: timelineSequence,
    timeline_conversation_status: timelineConversationStatus,
    gap_days_customer_vs_me: gapDaysCustomerVsMe == null ? 'unknown' : String(gapDaysCustomerVsMe),
    gap_hours_customer_vs_me: gapHoursCustomerVsMe == null ? 'unknown' : String(gapHoursCustomerVsMe),
    gap_minutes_customer_vs_me: gapMinutesCustomerVsMe == null ? 'unknown' : String(gapMinutesCustomerVsMe),
    hours_since_last_customer_message: hoursSinceLastCustomerMessage == null ? 'unknown' : String(hoursSinceLastCustomerMessage),
    hours_since_last_my_message: hoursSinceLastMyMessage == null ? 'unknown' : String(hoursSinceLastMyMessage),
    days_since_last_customer_message: daysSinceLastCustomerMessage == null ? 'unknown' : String(daysSinceLastCustomerMessage),
    days_since_last_my_message: daysSinceLastMyMessage == null ? 'unknown' : String(daysSinceLastMyMessage),

    cleaned_message_count: uniqueMessages.length,
    recent_message_count: recentMessages.length,
    core_message_count: coreMessages.length,
    full_conversation_length: cleanedFullConversation.length,
    customer_message_count: customerMessageCount,
    my_message_count: myMessageCount,
    original_message_count: input.original_message_count ?? input.message_count ?? parsedMessages.length,
    deduplicated_message_count: uniqueMessages.length,

    has_customer_reply: hasReply,
    has_price_signal: hasPriceSignal,
    has_timing_signal: hasTimingSignal,
    has_not_now_signal: hasNotNowSignal,
    last_customer_gap_hint: lastCustomerGapHint,

    is_my_turn_to_reply: isMyTurnToReply,
    should_reactivate_now: shouldReactivateNow,
    customer_replied_after_my_last_message: customerRepliedAfterMyLastMessage,
    is_customer_silent_after_my_message: isCustomerSilentAfterMyMessage,

    customer_last_message_type: customerLastMessageType,

    last_exchange: lastExchange,

    stage: derivedStage,
    follow_up_priority: derivedPriority,
    status: derivedStatus,

    customer_type: finalCustomerType,
    intent_level: derivedIntentLevelRaw || 'unknown',
    purchase_stage: finalPurchaseStage,
    product_interest: finalProductInterest,
    quantity_signal: finalQuantitySignal,
    concerns: finalConcerns,
    key_signals: finalKeySignals,

    current_blocker: currentBlocker,
    strategy_direction: strategyDirection,
    reply_angle: replyAngle,
    follow_up_focus: followUpFocus,

    primary_reply_anchor: primaryReplyAnchor,
    secondary_context: secondaryContext,
    reply_risk: replyRisk,

    _debug_source: input._debug_source || '',
    _project_signals: projectSignals,
    stop_point_analysis: stopPointAnalysis,
    forbidden_repeat_zone: forbiddenRepeatZone,
    reactivation_decision_basis: reactivationDecisionBasis,
    reactivation_v6_core: reactivationV6Core,
    reactivation_ai_payload: aiPayload
  };
}

module.exports = { buildAIContext };
