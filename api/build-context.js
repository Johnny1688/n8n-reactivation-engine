const { buildAIContext } = require('../src/context/buildAIContext');

function safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function cleanCustomerName(raw) {
  if (!raw) return '';
  if (/^\+\d/.test(raw.trim())) return '';
  let name = raw
    .replace(/\d+台/g, '')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[（()）]+/g, ' ')
    .replace(/\d{1,4}[\.\-\/]\d{1,2}[\.\-\/]?\d{0,2}日?/g, '')
    .replace(/\b[A-Z]{2}\d{3}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = name.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';
  return words[0];
}

function normalizeText(value) {
  return safeString(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function uniqueNonEmpty(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildContextText(result) {
  const parts = [
    result.customer_only_text,
    result.customer_recent_only_text,
    result.last_customer_message,
    result.seller_only_text,
    result.last_my_message,
    result.recent_conversation,
    result.conversation_core,
    result.cleaned_full_conversation,
    result.timeline_summary,
    result.dated_history_summary,
    result.project_key,
    result.product_interest,
    result.concerns,
    result.key_signals
  ];
  return parts.filter(Boolean).join('\n').toLowerCase();
}

function roleMessageCount(result, role) {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  return messages.filter(message => message && message.role === role && safeString(message.message).trim()).length;
}

function deriveRuntimeConversationSummary(result, text) {
  if (hasUsableConversationSummary(result)) return null;

  const customerMessageCount = roleMessageCount(result, 'customer');
  const sellerMessageCount = roleMessageCount(result, 'me');
  const fullHistory = safeString(result.cleaned_full_conversation).trim();

  // Runtime evidence may replace a missing persisted summary only when the
  // complete loaded history contains both speakers and a concrete sales anchor.
  if (!customerMessageCount || !sellerMessageCount || !fullHistory || !hasConcreteAnchorSignal(result, text)) {
    return null;
  }

  return {
    source: 'full_history_runtime',
    message_count: customerMessageCount + sellerMessageCount,
    customer_message_count: customerMessageCount,
    seller_message_count: sellerMessageCount,
    last_customer_signal: safeString(result.last_customer_message).slice(0, 240),
    last_seller_action: safeString(result.last_my_message).slice(0, 240),
    display_text: [
      `Customer: ${safeString(result.last_customer_message).slice(0, 240)}`,
      `Seller: ${safeString(result.last_my_message).slice(0, 240)}`
    ].join(' | ')
  };
}

function detectHardNoSend(result, text) {
  if (result.has_not_now_signal === true) return true;

  return hasAny(text, [
    /\bi(?:'|’)?ll let you know\b/,
    /\bi will let you know\b/,
    /\bwill reach out\b/,
    /\breach out later\b/,
    /\bget back to you\b/,
    /\bnot now\b/,
    /\bnot at the moment\b/,
    /\bnot currently\b/,
    /\bnot looking\b.*\bright now\b/,
    /\bnot ready\b.*\bright now\b/,
    /\bnot ready yet\b/,
    /\bmaybe later\b/,
    /\bwhen\b.*\bnew client\b/,
    /\bnew client\b.*\bcomes?\b/,
    /\bmarket\b.*\bslow\b/,
    /\bno purchases?\b.*\bnow\b/,
    /\bno purchase\b.*\bright now\b/,
    /\bwent with another supplier\b/,
    /\balready\b.*\b(ordered|purchased|bought)\b.*\b(elsewhere|another supplier)\b/
  ]);
}

function includesForbiddenTopic(result, topic) {
  const topics = result.forbidden_repeat_zone?.already_sent_topics;
  return Array.isArray(topics) && topics.includes(topic);
}

function detectProductCode(text) {
  const match = text.match(/\b(ar|mr|or|fr|mg|pr)\d{3}\b/i);
  return match ? match[0].toLowerCase() : '';
}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  }
  return false;
}

function isSendableState(sendState) {
  return !['no_send', 'manual_context_required'].includes(safeString(sendState));
}

function hasUsableConversationSummary(result) {
  const summary = result.conversation_summary || result.runtime_conversation_summary;
  if (summary == null) return false;

  if (typeof summary === 'string') {
    const trimmed = summary.trim();
    return trimmed.length >= 40 && !['null', '{}', '[]'].includes(trimmed);
  }

  if (Array.isArray(summary)) return summary.length > 0;
  if (typeof summary === 'object') return Object.keys(summary).length > 0;
  return Boolean(summary);
}

function hasConcreteAnchorSignal(result, text) {
  if (detectProductCode(text)) return true;
  if (/\$\s*\d|\busd\s*\d|\b\d+\s*(?:units?|pcs|pieces|reformers?|machines?)\b/i.test(text)) return true;
  if (/\b(?:catalog|brochure|pdf|photos?|pictures?|videos?|warranty|shipping|freight|delivery|ddp|invoice|pi|deposit|payment|quote|pricing|price|october|studio|distributor|dealer|reseller)\b/i.test(text)) return true;
  if (hasAny(text, [
    /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i,
    /\b\d{5}(?:-\d{4})?\b/,
    /\b(?:canada|usa|united states|australia|new zealand|philippines|sri lanka|qatar|iraq|mexico)\b/i
  ])) return true;
  return false;
}

function hasVeryShortCustomerContext(result) {
  const lastCustomer = safeString(result.last_customer_message);
  const customerText = [result.customer_only_text, result.customer_recent_only_text]
    .map(safeString)
    .join(' ')
    .trim();

  return lastCustomer.length > 0 && lastCustomer.length < 20 && customerText.length < 80;
}

function hasMissingCustomerContext(result) {
  const lastCustomer = safeString(result.last_customer_message);
  const customerText = [result.customer_only_text, result.customer_recent_only_text]
    .map(safeString)
    .join(' ')
    .trim();

  return !lastCustomer && !customerText;
}

function hasWeakIdentity(result) {
  const cleanName = cleanCustomerName(result.customer_name || result.project_key);
  const rawName = safeString(result.customer_name || result.project_key);
  if (!cleanName) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(rawName)) return true;
  return /^(unknown|test|facebook|facebook business|meta|meta business)$/i.test(rawName);
}

function deriveManualContextHold(result, text) {
  const reasons = [];
  const concreteAnchor = hasConcreteAnchorSignal(result, text);

  if (isTruthy(result.is_my_turn_to_reply)) {
    reasons.push('my_turn_requires_manual_reply');
  }
  if (hasMissingCustomerContext(result)) {
    reasons.push('missing_customer_context');
  }
  if (hasVeryShortCustomerContext(result) && !concreteAnchor) {
    reasons.push('very_short_customer_context_without_anchor');
  }
  if (!hasUsableConversationSummary(result) && !concreteAnchor) {
    reasons.push('missing_summary_without_concrete_anchor');
  }
  if (hasWeakIdentity(result) && !concreteAnchor) {
    reasons.push('weak_identity_without_concrete_anchor');
  }
  if (
    /quote|quoted|pricing|price|payment|deposit|invoice|pi/i.test(text) &&
    !/\$\s*\d|\busd\s*\d|\b(?:invoice|pi|deposit|payment|quote|pricing|price)\b/i.test(text)
  ) {
    reasons.push('quote_payment_context_gap');
  }

  return reasons;
}

function deriveExecutionGuidance(result) {
  const text = buildContextText(result);
  const customerType = safeString(result.customer_last_message_type);
  const purchaseStage = safeString(result.purchase_stage);
  const productCode = detectProductCode(text);
  const hardNoSend = detectHardNoSend(result, text);

  if (hardNoSend) {
    return {
      anchorObject: 'no_send_not_now',
      allowedMicroTriggers: [],
      sendState: 'no_send',
      hardNoSend: true,
      primaryTrigger: 'no_send_not_now',
      triggerReason: 'explicit_not_now_or_do_not_push_signal'
    };
  }

  const manualHoldReasons = deriveManualContextHold(result, text);
  if (manualHoldReasons.length > 0) {
    return {
      anchorObject: 'manual_context_required',
      allowedMicroTriggers: [],
      sendState: 'manual_context_required',
      hardNoSend: false,
      manualHoldReasons,
      primaryTrigger: 'manual_context_required',
      triggerReason: manualHoldReasons.join(',')
    };
  }

  const hasCheaperComparison =
    customerType === 'comparison_signal' ||
    hasAny(text, [
      /\bcheaper\b/,
      /\blower price\b/,
      /\bbetter price\b/,
      /\bother supplier\b/,
      /\bother factory\b/,
      /\bcompare\b/,
      /\bcomparison\b/
    ]);

  if (hasCheaperComparison) {
    return {
      anchorObject: 'cheaper_option_difference',
      allowedMicroTriggers: ['clarify_why_cheaper_here'],
      sendState: 'rewrite_needed',
      hardNoSend: false,
      primaryTrigger: 'clarify_why_cheaper_here',
      triggerReason: 'customer_raised_cheaper_option_or_comparison'
    };
  }

  const hasCatalogContext =
    includesForbiddenTopic(result, 'catalog') ||
    hasAny(text, [
      /\bcatalog\b/,
      /\bbrochure\b/,
      /\bpdf\b/
    ]);

  if (hasCatalogContext && hasAny(text, [/\bdownload\b/, /\bfailed?\b/, /\bopen\b/, /\blink\b/, /\bresend\b/, /\bsend\b/])) {
    return {
      anchorObject: 'catalog_redelivery',
      allowedMicroTriggers: ['resend_catalog_here'],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: 'resend_catalog_here',
      triggerReason: 'catalog_or_pdf_context_detected'
    };
  }

  const hasPhotoVideoContext =
    includesForbiddenTopic(result, 'photos/videos') ||
    hasAny(text, [
      /\bphotos?\b/,
      /\bpictures?\b/,
      /\bvideos?\b/,
      /\bimages?\b/
    ]);

  if (hasPhotoVideoContext && productCode) {
    const trigger = `send_${productCode}_photos_here`;
    return {
      anchorObject: `${productCode}_photos_video`,
      allowedMicroTriggers: [trigger],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: trigger,
      triggerReason: 'specific_model_photo_or_video_context_detected'
    };
  }

  const hasEightVsTenContext =
    hasAny(text, [/\b8\b.*\b10\b/, /\b10\b.*\b8\b/]) &&
    hasAny(text, [/\bunits?\b/, /\bpcs\b/, /\bpieces\b/, /\breformers?\b/, /\bmachines?\b/]);

  if (hasEightVsTenContext) {
    return {
      anchorObject: 'eight_vs_ten_unit_plan',
      allowedMicroTriggers: ['line_up_8_vs_10_here'],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: 'line_up_8_vs_10_here',
      triggerReason: 'eight_vs_ten_quantity_context_detected'
    };
  }

  const hasTimingContext =
    result.has_timing_signal === true ||
    hasAny(text, [
      /\boctober\b/,
      /\blate october\b/,
      /\blate fall\b/,
      /\bfall\b/,
      /\bopening\b/,
      /\barrival\b/,
      /\barrive\b/,
      /\btimeline\b/,
      /\bdelivery timing\b/
    ]);

  if (hasTimingContext) {
    return {
      anchorObject: 'october_arrival_timing',
      allowedMicroTriggers: ['line_up_october_timing_here'],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: 'line_up_october_timing_here',
      triggerReason: 'timing_or_october_planning_context_detected'
    };
  }

  const hasPriceContext =
    result.has_price_signal === true ||
    purchaseStage === 'pricing' ||
    includesForbiddenTopic(result, 'price') ||
    hasAny(text, [
      /\bprice\b/,
      /\bpricing\b/,
      /\bprice range\b/,
      /\bcost\b/,
      /\bquote\b/,
      /\bquoted\b/,
      /\bhow much\b/,
      /\bsample price\b/,
      /\bone unit\b/,
      /\b1 unit\b/,
      /\$\s*\d/
    ]);

  if (hasPriceContext) {
    return {
      anchorObject: 'one_unit_price_range',
      allowedMicroTriggers: ['resend_price_range_here'],
      sendState: 'rewrite_needed',
      hardNoSend: false,
      primaryTrigger: 'resend_price_range_here',
      triggerReason: 'pricing_or_quote_context_detected'
    };
  }

  const hasShippingContext =
    includesForbiddenTopic(result, 'shipping') ||
    includesForbiddenTopic(result, 'delivery time') ||
    hasAny(text, [
      /\bshipping\b/,
      /\bfreight\b/,
      /\bdelivery\b/,
      /\blead time\b/,
      /\bzip\b/,
      /\bhouston\b/,
      /\bddp\b/
    ]);

  if (hasShippingContext) {
    return {
      anchorObject: 'shipping_delivery_summary',
      allowedMicroTriggers: ['resend_shipping_summary_here'],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: 'resend_shipping_summary_here',
      triggerReason: 'shipping_or_delivery_context_detected'
    };
  }

  const hasWarrantyContext =
    includesForbiddenTopic(result, 'warranty') ||
    hasAny(text, [/\bwarranty\b/, /\bmaintenance\b/, /\bafter-sales\b/, /\bafter sales\b/]);

  if (hasWarrantyContext) {
    return {
      anchorObject: 'warranty_terms_summary',
      allowedMicroTriggers: ['resend_warranty_summary_here'],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: 'resend_warranty_summary_here',
      triggerReason: 'warranty_context_detected'
    };
  }

  const hasPaymentContext =
    includesForbiddenTopic(result, 'payment terms') ||
    hasAny(text, [/\bpayment\b/, /\bdeposit\b/, /\bpayment plan\b/, /\bpayment terms\b/, /\binvoice\b/, /\bpi\b/]);

  if (hasPaymentContext) {
    return {
      anchorObject: 'payment_deposit_summary',
      allowedMicroTriggers: ['resend_payment_terms_here'],
      sendState: 'sendable',
      hardNoSend: false,
      primaryTrigger: 'resend_payment_terms_here',
      triggerReason: 'payment_or_deposit_context_detected'
    };
  }

  const hasModelContext =
    includesForbiddenTopic(result, 'model recommendation') ||
    purchaseStage === 'selection' ||
    hasAny(text, [
      /\bmodel\b/,
      /\bmodels\b/,
      /\breformer\b/,
      /\bsetup\b/,
      /\boption\b/,
      /\boptions\b/,
      /\bwhich one\b/
    ]);

  if (hasModelContext) {
    return {
      anchorObject: productCode ? `${productCode}_model_option` : 'model_option_summary',
      allowedMicroTriggers: ['line_up_model_options_here'],
      sendState: 'rewrite_needed',
      hardNoSend: false,
      primaryTrigger: 'line_up_model_options_here',
      triggerReason: 'model_or_selection_context_detected'
    };
  }

  return {
    anchorObject: 'last_interaction_summary',
    allowedMicroTriggers: ['simplify_last_point_here'],
    sendState: 'rewrite_needed',
    hardNoSend: false,
    primaryTrigger: 'simplify_last_point_here',
    triggerReason: 'fallback_to_last_interaction_context'
  };
}

function buildStopPoint(result, guidance) {
  return {
    ...(result.stop_point_analysis || {}),
    smallest_reply_to_trigger: guidance.primaryTrigger,
    anchor_object: guidance.anchorObject,
    allowed_micro_triggers: guidance.allowedMicroTriggers,
    send_state: guidance.sendState,
    hard_no_send: guidance.hardNoSend,
    manual_hold_reasons: guidance.manualHoldReasons || []
  };
}

function buildForbiddenRepeatZone(result, guidance) {
  return {
    ...(result.forbidden_repeat_zone || {}),
    allowed_micro_triggers: guidance.allowedMicroTriggers
  };
}

function buildDecisionBasis(result, guidance, forbiddenRepeatZone) {
  return {
    ...(result.reactivation_decision_basis || {}),
    best_trigger_type: guidance.primaryTrigger,
    best_trigger_reason: guidance.triggerReason,
    smallest_reply_goal: guidance.primaryTrigger,
    primary_anchor: guidance.anchorObject,
    anchor_object: guidance.anchorObject,
    allowed_micro_triggers: guidance.allowedMicroTriggers,
    send_state: guidance.sendState,
    hard_no_send: guidance.hardNoSend,
    manual_hold_reasons: guidance.manualHoldReasons || [],
    must_avoid: Array.isArray(forbiddenRepeatZone.do_not_repeat) ? forbiddenRepeatZone.do_not_repeat : [],
    // Legacy/debug compatibility only. Downstream execution should use send_state and hard_no_send.
    should_follow_up_now: isSendableState(guidance.sendState)
  };
}

function buildReactivationPayload(result, guidance, stopPointAnalysis, forbiddenRepeatZone, decisionBasis) {
  const existingPayload = result.reactivation_ai_payload || {};
  const existingTimeline = existingPayload.timeline || {};
  const existingLastSignal = existingPayload.last_signal || {};
  const existingStopPoint = existingPayload.stop_point || {};
  const existingConstraints = existingPayload.constraints || {};
  const existingDecision = existingPayload.decision || {};

  return {
    timeline: {
      ...existingTimeline,
      last_customer_message_time: existingTimeline.last_customer_message_time || result.last_customer_message_time || 'unknown',
      last_my_message_time: existingTimeline.last_my_message_time || result.last_my_message_time || 'unknown',
      gap_days: toNumber(existingTimeline.gap_days ?? result.gap_days_customer_vs_me, 0)
    },
    last_signal: {
      ...existingLastSignal,
      type: existingLastSignal.type || result.customer_last_message_type || 'unknown',
      summary: existingLastSignal.summary || safeString(result.last_customer_message).slice(0, 80) || 'no clear signal',
      confidence: existingLastSignal.confidence || (result.customer_last_message_type && result.customer_last_message_type !== 'unknown' ? 'high' : 'medium'),
      anchor_object: guidance.anchorObject
    },
    stop_point: {
      ...existingStopPoint,
      where_it_stopped: existingStopPoint.where_it_stopped || stopPointAnalysis.where_it_stopped || '',
      why_it_stopped: existingStopPoint.why_it_stopped || stopPointAnalysis.why_it_stopped_there || '',
      smallest_reply_to_trigger: guidance.primaryTrigger,
      anchor_object: guidance.anchorObject,
      allowed_micro_triggers: guidance.allowedMicroTriggers,
      send_state: guidance.sendState,
      hard_no_send: guidance.hardNoSend,
      manual_hold_reasons: guidance.manualHoldReasons || []
    },
    constraints: {
      ...existingConstraints,
      must_avoid: uniqueNonEmpty(existingConstraints.must_avoid || []),
      must_follow: uniqueNonEmpty([...(existingConstraints.must_follow || []), 'single micro-trigger', 'concrete conversation anchor']),
      do_not_repeat: Array.isArray(forbiddenRepeatZone.do_not_repeat) ? forbiddenRepeatZone.do_not_repeat : [],
      allowed_micro_triggers: guidance.allowedMicroTriggers
    },
    decision: {
      ...existingDecision,
      best_trigger_type: guidance.primaryTrigger,
      best_trigger_reason: guidance.triggerReason,
      smallest_reply_goal: guidance.primaryTrigger,
      primary_anchor: guidance.anchorObject,
      anchor_object: guidance.anchorObject,
      allowed_micro_triggers: guidance.allowedMicroTriggers,
      send_state: guidance.sendState,
      hard_no_send: guidance.hardNoSend,
      manual_hold_reasons: guidance.manualHoldReasons || [],
      // Legacy/debug compatibility only. Downstream execution should use send_state and hard_no_send.
      should_follow_up_now: isSendableState(guidance.sendState)
    }
  };
}

function buildReactivationV6Core(result, guidance, stopPointAnalysis, forbiddenRepeatZone, decisionBasis) {
  const existing = result.reactivation_v6_core || {};

  return {
    ...existing,
    stop_point_analysis: stopPointAnalysis,
    forbidden_repeat_zone: forbiddenRepeatZone,
    reactivation_decision_basis: decisionBasis,
    anchor_object: guidance.anchorObject,
    allowed_micro_triggers: guidance.allowedMicroTriggers,
    send_state: guidance.sendState,
    hard_no_send: guidance.hardNoSend,
    manual_hold_reasons: guidance.manualHoldReasons || []
  };
}

function enhanceBuildContextResult(result) {
  const contextText = buildContextText(result);
  const runtimeConversationSummary = deriveRuntimeConversationSummary(result, contextText);
  const contextResult = {
    ...result,
    runtime_conversation_summary: runtimeConversationSummary,
    full_history_evidence_used: Boolean(runtimeConversationSummary)
  };
  const guidance = deriveExecutionGuidance(contextResult);
  const stopPointAnalysis = buildStopPoint(contextResult, guidance);
  const forbiddenRepeatZone = buildForbiddenRepeatZone(contextResult, guidance);
  const reactivationDecisionBasis = buildDecisionBasis(contextResult, guidance, forbiddenRepeatZone);
  const reactivationAiPayload = buildReactivationPayload(
    contextResult,
    guidance,
    stopPointAnalysis,
    forbiddenRepeatZone,
    reactivationDecisionBasis
  );
  const reactivationV6Core = buildReactivationV6Core(
    contextResult,
    guidance,
    stopPointAnalysis,
    forbiddenRepeatZone,
    reactivationDecisionBasis
  );

  return {
    ...contextResult,
    customer_name_clean: cleanCustomerName(contextResult.customer_name || contextResult.project_key),
    has_not_now_signal: contextResult.has_not_now_signal === true || guidance.hardNoSend,
    // Legacy/debug compatibility only. Downstream execution should use send_state and hard_no_send.
    should_reactivate_now: contextResult.should_reactivate_now,
    primary_reply_anchor: guidance.anchorObject,
    anchor_object: guidance.anchorObject,
    allowed_micro_triggers: guidance.allowedMicroTriggers,
    manual_hold_reasons: guidance.manualHoldReasons || [],
    send_state: guidance.sendState,
    hard_no_send: guidance.hardNoSend,
    stop_point_analysis: stopPointAnalysis,
    forbidden_repeat_zone: forbiddenRepeatZone,
    reactivation_decision_basis: reactivationDecisionBasis,
    reactivation_ai_payload: reactivationAiPayload,
    reactivation_v6_core: reactivationV6Core
  };
}

module.exports = async function (req, res) {
  try {
    const input = req.body || {};
    const result = buildAIContext(input);
    res.status(200).json(enhanceBuildContextResult(result));
  } catch (err) {
    res.status(500).json({
      error: true,
      message: err.message || 'build-context failed'
    });
  }
};
