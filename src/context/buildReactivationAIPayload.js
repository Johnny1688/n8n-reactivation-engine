function buildReactivationAIPayload({ reactivationV6Core }) {
  return {
    timeline: reactivationV6Core.timeline_facts,
    last_signal: reactivationV6Core.last_customer_signal,
    stop_point: reactivationV6Core.stop_point_analysis,
    constraints: reactivationV6Core.forbidden_repeat_zone,
    decision: reactivationV6Core.reactivation_decision_basis
  };
}

module.exports = { buildReactivationAIPayload };
