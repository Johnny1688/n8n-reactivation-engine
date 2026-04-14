function parseTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAfterOrSame(a, b) {
  const aa = parseTime(a);
  const bb = parseTime(b);

  if (!aa || !bb) return false;
  return aa.getTime() >= bb.getTime();
}

function isAfter(a, b) {
  const aa = parseTime(a);
  const bb = parseTime(b);

  if (!aa || !bb) return false;
  return aa.getTime() > bb.getTime();
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractLastQuestion(text) {
  const normalized = normalizeText(text);
  if (!normalized) return '';

  const explicitQuestions = normalized.match(/[^?？.!。！]*[?？]/g);
  if (explicitQuestions?.length) {
    return explicitQuestions[explicitQuestions.length - 1].trim();
  }

  const sentences = normalized
    .split(/[.!。！\n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const questionStarter = /^(which|what|when|where|who|why|how|can|could|would|do|does|did|is|are|will|should|may|have|has)\b/i;
  const questionLike = /\b(which|what|when|where|who|why|how much|how many)\b/i;

  for (let i = sentences.length - 1; i >= 0; i--) {
    if (questionStarter.test(sentences[i]) || questionLike.test(sentences[i])) {
      return sentences[i];
    }
  }

  return '';
}

function findMessageIndex(messages, target) {
  if (!target) return -1;

  const directIndex = messages.lastIndexOf(target);
  if (directIndex >= 0) return directIndex;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message?.role === target.role &&
      (message?.message || '') === (target.message || '') &&
      (message?.message_time || '') === (target.message_time || '')
    ) {
      return i;
    }
  }

  return -1;
}

function customerRepliedAfterMyMessage(messages, lastCustomerMessageObj, lastMyMessageObj) {
  if (!lastCustomerMessageObj || !lastMyMessageObj) return false;

  if (isAfter(lastCustomerMessageObj.message_time, lastMyMessageObj.message_time)) {
    return true;
  }

  const myIndex = findMessageIndex(messages, lastMyMessageObj);
  const customerIndex = findMessageIndex(messages, lastCustomerMessageObj);

  return myIndex >= 0 && customerIndex > myIndex;
}

function isDirectAnswerToQuestion(question, answer) {
  const q = normalizeText(question).toLowerCase();
  const a = normalizeText(answer).toLowerCase();

  if (!q || !a) return false;
  if (extractLastQuestion(a)) return false;

  const yesNoQuestion = /^(can|could|would|do|does|did|is|are|will|should|may|have|has)\b/.test(q);
  if (yesNoQuestion && /\b(yes|yeah|yep|sure|ok|okay|no|not|maybe)\b/.test(a)) return true;

  if (/\b(which|model|product)\b/.test(q)) {
    return /\b(ar|mr|or|fr|mg|pr)\d{3}\b|\breformer\b|\bmegaformer\b|\blagree\b|\bfolding\b|\bfoldable\b|\baluminum\b|\baluminium\b|\bwood\b|\bwooden\b|\btower\b|\bcadillac\b|\bchair\b|\bbarrel\b/i.test(a);
  }

  if (/\b(price|cost|quote|budget|how much)\b/.test(q)) {
    return /\b(price|cost|quote|budget|expensive|cheap|cheaper)\b|[$€£¥]|\b\d+(?:[.,]\d+)?\b/.test(a);
  }

  if (/\b(quantity|how many|units|pcs|pieces|machines|beds|reformers)\b/.test(q)) {
    return /\b\d{1,3}\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|sample)\b/.test(a);
  }

  if (/\b(when|timeline|delivery|ship|shipping|arrive|lead time)\b/.test(q)) {
    return /\b(today|tomorrow|week|month|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter)\b|\b\d{1,2}[./-]\d{1,2}\b/.test(a);
  }

  return false;
}

function analyzeStopPoint({
  messages,
  lastCustomerMessageObj,
  lastMyMessageObj,
  customerLastMessageType,
  finalPurchaseStage,
  hasTimingSignal,
  hasNotNowSignal
}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastMessage = safeMessages[safeMessages.length - 1] || null;

  const lastCustomerMessage = lastCustomerMessageObj?.message || '';
  const lastCustomerTime = lastCustomerMessageObj?.message_time || '';
  const lastMyMessage = lastMyMessageObj?.message || '';
  const lastMyTime = lastMyMessageObj?.message_time || '';
  const lastMyQuestion = extractLastQuestion(lastMyMessage);

  const myLastPushIsUnanswered =
    !!lastMyMessageObj &&
    (!lastCustomerMessageObj || isAfterOrSame(lastMyTime, lastCustomerTime));
  const customerAnsweredAfterMyLastPush =
    customerRepliedAfterMyMessage(safeMessages, lastCustomerMessageObj, lastMyMessageObj);
  const customerDirectlyAnsweredMyQuestion =
    customerAnsweredAfterMyLastPush &&
    isDirectAnswerToQuestion(lastMyQuestion, lastCustomerMessage);
  const didMyLastPushFail =
    !!lastMyQuestion && !customerDirectlyAnsweredMyQuestion;

  let whereItStopped = '';
  if (lastMessage?.role === 'customer') {
    whereItStopped = 'customer_last_message';
  } else if (lastMessage?.role === 'me') {
    whereItStopped = 'my_last_message';
  }

  let whyItStoppedThere = '';
  if (hasNotNowSignal) {
    whyItStoppedThere = 'customer_not_now_signal';
  } else if (customerLastMessageType === 'polite_close') {
    whyItStoppedThere = 'customer_polite_close';
  } else if (customerLastMessageType === 'comparison_signal') {
    whyItStoppedThere = 'customer_price_comparison_signal';
  } else if (customerLastMessageType === 'timing_delay' || hasTimingSignal) {
    whyItStoppedThere = 'customer_timing_signal';
  } else if (customerLastMessageType === 'question') {
    whyItStoppedThere = 'customer_question_pending';
  } else if (didMyLastPushFail) {
    whyItStoppedThere = 'my_last_question_unanswered';
  } else if (myLastPushIsUnanswered) {
    whyItStoppedThere = 'my_last_message_unanswered';
  } else if (lastMessage?.role === 'customer') {
    whyItStoppedThere = 'customer_replied_last';
  }

  let smallestReplyToTrigger = '';
  if (didMyLastPushFail) {
    smallestReplyToTrigger = 'answer_simple_version_of_last_question';
  } else if (customerLastMessageType === 'comparison_signal' || customerLastMessageType === 'price_reaction_soft' || finalPurchaseStage === 'pricing') {
    smallestReplyToTrigger = 'confirm_price_step';
  } else if (hasNotNowSignal) {
    smallestReplyToTrigger = 'acknowledge_timing';
  } else if (customerLastMessageType === 'question') {
    smallestReplyToTrigger = 'answer_customer_question';
  } else if (customerLastMessageType === 'timing_delay' || hasTimingSignal) {
    smallestReplyToTrigger = 'ask_timing_update';
  } else if (finalPurchaseStage === 'selection') {
    smallestReplyToTrigger = 'confirm_model_selection';
  } else if (myLastPushIsUnanswered) {
    smallestReplyToTrigger = 'soft_reopen';
  }

  return {
    where_it_stopped: whereItStopped,
    why_it_stopped_there: whyItStoppedThere,
    what_my_last_push_was: lastMyMessage,
    what_customer_did_not_answer: didMyLastPushFail ? lastMyQuestion : '',
    did_my_last_push_fail: didMyLastPushFail,
    smallest_reply_to_trigger: smallestReplyToTrigger
  };
}

module.exports = { analyzeStopPoint };
