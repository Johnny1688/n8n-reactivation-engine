function buildReactivationDecisionBasis({
  shouldReactivateNow,
  stopPointAnalysis,
  forbiddenRepeatZone,
  customerLastMessageType,
  finalPurchaseStage,
  hasTimingSignal,
  hasNotNowSignal
}) {
  let bestTriggerType = '';

  if (hasNotNowSignal) {
    bestTriggerType = 'do_not_follow_up';
  } else if (stopPointAnalysis?.smallest_reply_to_trigger === 'answer_simple_version_of_last_question') {
    bestTriggerType = 'lower_friction_answer_path';
  } else if (finalPurchaseStage === 'pricing') {
    bestTriggerType = 'price_step';
  } else if (hasTimingSignal) {
    bestTriggerType = 'timing_reactivation';
  } else {
    bestTriggerType = 'soft_reopen';
  }

  const triggerReasons = {
    do_not_follow_up: 'customer_not_now_signal_detected',
    lower_friction_answer_path: 'last_question_was_not_answered',
    price_step: 'purchase_stage_is_pricing',
    timing_reactivation: 'timing_signal_detected',
    soft_reopen: 'no_specific_trigger_detected'
  };

  return {
    should_follow_up_now: !!shouldReactivateNow,
    best_trigger_type: bestTriggerType,
    best_trigger_reason: triggerReasons[bestTriggerType] || '',
    must_avoid: Array.isArray(forbiddenRepeatZone?.do_not_repeat) ? forbiddenRepeatZone.do_not_repeat : [],
    smallest_reply_goal: stopPointAnalysis?.smallest_reply_to_trigger || ''
  };
}

module.exports = { buildReactivationDecisionBasis };
