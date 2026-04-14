function buildReactivationV6Core({
  timeline,
  lastExchange,
  customerLastMessageType,
  currentBlocker,
  stopPointAnalysis,
  forbiddenRepeatZone,
  reactivationDecisionBasis
}) {
  return {
    timeline_facts: {
      last_customer_message_time: timeline?.last_customer_message_time || '',
      last_my_message_time: timeline?.last_my_message_time || '',
      who_should_reply_next: timeline?.who_should_reply_next || '',
      days_since_last_customer_message: timeline?.days_since_last_customer_message || '',
      days_since_last_my_message: timeline?.days_since_last_my_message || '',
      conversation_status: timeline?.conversation_status || ''
    },
    last_customer_signal: {
      last_customer_message: lastExchange?.last_customer_message || '',
      last_customer_message_type: customerLastMessageType || ''
    },
    stop_point_analysis: stopPointAnalysis || {},
    forbidden_repeat_zone: forbiddenRepeatZone || {},
    reactivation_decision_basis: reactivationDecisionBasis || {}
  };
}

module.exports = { buildReactivationV6Core };
