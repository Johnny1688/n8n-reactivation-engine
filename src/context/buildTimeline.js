function parseDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function formatGap(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatGapZh(ms) {
  if (ms == null || Number.isNaN(ms)) return '未知';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);

  if (days > 0) return `${days}天`;
  if (hours > 0) return `${hours}小时`;
  return `${minutes}分钟`;
}

function formatDateDisplay(v) {
  const d = parseDateSafe(v);
  if (!d) return 'unknown';

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function diffDaysAbs(a, b) {
  if (!a || !b) return null;
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86400000);
}

function diffHoursAbs(a, b) {
  if (!a || !b) return null;
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 3600000);
}

function diffMinutesAbs(a, b) {
  if (!a || !b) return null;
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 60000);
}

function hoursSince(nowObj, pastObj) {
  if (!nowObj || !pastObj) return null;
  return Math.floor((nowObj.getTime() - pastObj.getTime()) / 3600000);
}

function daysSince(nowObj, pastObj) {
  if (!nowObj || !pastObj) return null;
  return Math.floor((nowObj.getTime() - pastObj.getTime()) / 86400000);
}

function buildTimeline(input, uniqueMessages) {
  // =========================
  // 9) 关键消息提取
  // =========================
  const firstMessageObj = uniqueMessages[0] || null;
  const lastMessageObj = uniqueMessages[uniqueMessages.length - 1] || null;

  const lastCustomerMessageObj =
    [...uniqueMessages].reverse().find(m => m.role === 'customer') || null;

  const lastMyMessageObj =
    [...uniqueMessages].reverse().find(m => m.role === 'me') || null;

  // =========================
  // 10) 时间结构
  // =========================
  const nowTime =
    input.now_time ||
    input.current_time ||
    new Date().toISOString();

  const nowTimeObj = parseDateSafe(nowTime);

  const firstMessageTime =
    firstMessageObj?.message_time ||
    input.first_message_time ||
    '';

  const lastCustomerTime =
    lastCustomerMessageObj?.message_time ||
    input.last_customer_message_time ||
    input.last_customer_message_time_normalized ||
    '';

  const lastMyTime =
    lastMyMessageObj?.message_time ||
    input.last_my_message_time ||
    input.last_my_message_time_normalized ||
    '';

  const lastMessageTime =
    lastMessageObj?.message_time ||
    input.last_message_time ||
    '';

  const firstMessageTimeObj = parseDateSafe(firstMessageTime);
  const lastCustomerTimeObj = parseDateSafe(lastCustomerTime);
  const lastMyTimeObj = parseDateSafe(lastMyTime);
  const lastMessageTimeObj = parseDateSafe(lastMessageTime);

  let lastCustomerGapHint = '';
  if (lastCustomerTimeObj && lastMyTimeObj) {
    lastCustomerGapHint = formatGap(Math.abs(lastMyTimeObj.getTime() - lastCustomerTimeObj.getTime()));
  }

  function detectWhoStopped() {
    if (!lastMessageObj) return 'unknown';
    if (lastMessageObj.role === 'customer') return 'me';
    if (lastMessageObj.role === 'me') return 'customer';
    return 'unknown';
  }

  function detectWhoShouldReplyNext() {
    if (!lastMessageObj) return 'unknown';
    if (lastMessageObj.role === 'customer') return 'me';
    if (lastMessageObj.role === 'me') return 'customer';
    return 'unknown';
  }

  function deriveSequenceLabel() {
    if (!lastMessageObj) return '无对话记录';
    if (lastMessageObj.role === 'customer') return '客户最后发言，等待我方回复';
    if (lastMessageObj.role === 'me') return '我方最后发言，等待客户回复';
    return '最后发言方未知';
  }

  function deriveConversationStatusFromTimeline() {
    if (!lastMessageObj) return 'open_no_messages';
    if (lastMessageObj.role === 'customer') return 'waiting_me';
    if (lastMessageObj.role === 'me') return 'waiting_customer';
    return 'open_unknown';
  }

  function buildTimelineEvents(messages, limit = 8) {
    return messages.slice(-limit).map(m => ({
      role: m.role,
      message_time: m.message_time || '',
      message_time_display: formatDateDisplay(m.message_time || ''),
      message: m.message
    }));
  }

  function buildDatedHistorySummary(messages, limit = 6) {
    const sliced = messages.slice(-limit);
    if (!sliced.length) return '无可用沟通记录';

    return sliced
      .map(m => {
        const roleZh = m.role === 'customer' ? '客户' : m.role === 'me' ? '我方' : '未知';
        const timeZh = formatDateDisplay(m.message_time || '');
        return `${timeZh}｜${roleZh}：${m.message}`;
      })
      .join('\n');
  }

  function buildTimelineSummary() {
    if (!uniqueMessages.length) return '暂无对话记录';

    const parts = [];

    if (firstMessageTimeObj) {
      parts.push(`首次记录：${formatDateDisplay(firstMessageTime)}`);
    }

    if (lastCustomerTimeObj) {
      parts.push(`客户最后回复：${formatDateDisplay(lastCustomerTime)}`);
    }

    if (lastMyTimeObj) {
      parts.push(`我方最后发送：${formatDateDisplay(lastMyTime)}`);
    }

    parts.push(`当前序列：${deriveSequenceLabel()}`);

    if (lastCustomerTimeObj && lastMyTimeObj) {
      parts.push(`最近双方消息间隔：${formatGapZh(Math.abs(lastMyTimeObj.getTime() - lastCustomerTimeObj.getTime()))}`);
    }

    return parts.join('；');
  }

  const whoStopped = detectWhoStopped();
  const whoShouldReplyNext = detectWhoShouldReplyNext();
  const timelineSequence = deriveSequenceLabel();
  const timelineConversationStatus = deriveConversationStatusFromTimeline();

  const gapDaysCustomerVsMe = diffDaysAbs(lastCustomerTimeObj, lastMyTimeObj);
  const gapHoursCustomerVsMe = diffHoursAbs(lastCustomerTimeObj, lastMyTimeObj);
  const gapMinutesCustomerVsMe = diffMinutesAbs(lastCustomerTimeObj, lastMyTimeObj);

  const hoursSinceLastCustomerMessage = hoursSince(nowTimeObj, lastCustomerTimeObj);
  const hoursSinceLastMyMessage = hoursSince(nowTimeObj, lastMyTimeObj);
  const daysSinceLastCustomerMessage = daysSince(nowTimeObj, lastCustomerTimeObj);
  const daysSinceLastMyMessage = daysSince(nowTimeObj, lastMyTimeObj);

  const timelineEvents = buildTimelineEvents(uniqueMessages, 8);
  const datedHistorySummary = buildDatedHistorySummary(uniqueMessages, 6);
  const timelineSummary = buildTimelineSummary();

  const timeline = {
    now_time: nowTime,
    now_time_display: formatDateDisplay(nowTime),
    first_message_time: firstMessageTime || '',
    first_message_time_display: formatDateDisplay(firstMessageTime || ''),
    last_customer_message_time: lastCustomerTime || '',
    last_customer_message_time_display: formatDateDisplay(lastCustomerTime || ''),
    last_my_message_time: lastMyTime || '',
    last_my_message_time_display: formatDateDisplay(lastMyTime || ''),
    last_message_time: lastMessageTime || '',
    last_message_time_display: formatDateDisplay(lastMessageTime || ''),
    last_message_role: lastMessageObj?.role || 'unknown',
    who_stopped: whoStopped,
    who_should_reply_next: whoShouldReplyNext,
    sequence: timelineSequence,
    conversation_status: timelineConversationStatus,
    gap_days_customer_vs_me: gapDaysCustomerVsMe == null ? 'unknown' : String(gapDaysCustomerVsMe),
    gap_hours_customer_vs_me: gapHoursCustomerVsMe == null ? 'unknown' : String(gapHoursCustomerVsMe),
    gap_minutes_customer_vs_me: gapMinutesCustomerVsMe == null ? 'unknown' : String(gapMinutesCustomerVsMe),
    hours_since_last_customer_message: hoursSinceLastCustomerMessage == null ? 'unknown' : String(hoursSinceLastCustomerMessage),
    hours_since_last_my_message: hoursSinceLastMyMessage == null ? 'unknown' : String(hoursSinceLastMyMessage),
    days_since_last_customer_message: daysSinceLastCustomerMessage == null ? 'unknown' : String(daysSinceLastCustomerMessage),
    days_since_last_my_message: daysSinceLastMyMessage == null ? 'unknown' : String(daysSinceLastMyMessage),
    gap_hint: lastCustomerGapHint || '',
    summary: timelineSummary,
    events: timelineEvents
  };

  return {
    firstMessageObj,
    lastMessageObj,
    lastCustomerMessageObj,
    lastMyMessageObj,
    nowTime,
    nowTimeObj,
    firstMessageTime,
    lastCustomerTime,
    lastMyTime,
    lastMessageTime,
    firstMessageTimeObj,
    lastCustomerTimeObj,
    lastMyTimeObj,
    lastMessageTimeObj,
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
  };
}

module.exports = {
  buildTimeline,
  parseDateSafe,
  formatGap,
  formatGapZh,
  formatDateDisplay,
  diffDaysAbs,
  diffHoursAbs,
  diffMinutesAbs,
  hoursSince,
  daysSince
};
