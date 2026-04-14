function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean))];
}

function shortenQuestion(question) {
  const text = normalizeText(question);
  if (text.length <= 120) return text;
  return `${text.slice(0, 117).trim()}...`;
}

function extractQuestions(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const explicitQuestions = normalized.match(/[^?？.!。！]*[?？]/g) || [];
  const questions = explicitQuestions.map(q => q.trim());

  const sentences = normalized
    .split(/[.!。！\n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const questionStarter = /^(which|what|when|where|who|why|how|can|could|would|do|does|did|is|are|will|should|may|have|has)\b/i;
  const questionLike = /\b(which|what|when|where|who|why|how much|how many)\b/i;

  for (const sentence of sentences) {
    if (questionStarter.test(sentence) || questionLike.test(sentence)) {
      questions.push(sentence);
    }
  }

  return uniqueNonEmpty(questions.map(shortenQuestion));
}

function detectSentTopics(text) {
  const t = normalizeText(text).toLowerCase();
  const topics = [];

  if (/\bprice|cost|quote|how much|expensive|cheaper\b/.test(t)) topics.push('price');
  if (/\bshipping|freight|ddp|tariff\b/.test(t)) topics.push('shipping');
  if (/\bdelivery time|lead time|delivery|deliver|shipment|ship|arrive|transit time\b/.test(t)) topics.push('delivery time');
  if (/\bwarranty|maintenance|after-sales|after sales\b/.test(t)) topics.push('warranty');
  if (/\bpayment terms?|payment plans?|deposit|30%|70%|invoice|pi\b/.test(t)) topics.push('payment terms');
  if (/\bcatalog|brochure\b/.test(t)) topics.push('catalog');
  if (/\bphotos?|pictures?|videos?|video|image|images\b/.test(t)) topics.push('photos/videos');
  if (/\bmodel recommendation|recommend|which model|help you choose|choose the right|best model|suitable model\b/.test(t)) topics.push('model recommendation');

  return topics;
}

function detectUsedAngles(text) {
  const t = normalizeText(text).toLowerCase();
  const angles = [];

  if (/\bprice|cost|quote|how much|lock price|secure price|hold price\b/.test(t)) {
    angles.push('price push');
  }

  if (/\bwhich model|recommend|help you choose|choose the right|best model|suitable model|options?\b/.test(t)) {
    angles.push('selection help');
  }

  if (/\btimeline|timing|check back|follow up|delivery time|lead time|opening|october|september|august|fall\b/.test(t)) {
    angles.push('timing follow-up');
  }

  if (/\bjust checking|quick follow|no pressure|when you have time|when convenient|still interested|touch base\b/.test(t)) {
    angles.push('low-pressure reopen');
  }

  if (/\bcompare|comparison|cheaper|expensive|better price|other supplier|other factory|match\b/.test(t)) {
    angles.push('comparison framing');
  }

  return angles;
}

function detectForbiddenRepeats({ messages }) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const myMessages = safeMessages.filter(message => (message?.role || '') === 'me');
  const myTexts = myMessages.map(message => message?.message || '');

  const alreadyAskedQuestions = uniqueNonEmpty(
    myTexts.flatMap(text => extractQuestions(text))
  );

  const alreadySentTopics = uniqueNonEmpty(
    myTexts.flatMap(text => detectSentTopics(text))
  );

  const alreadyUsedAngles = uniqueNonEmpty(
    myTexts.flatMap(text => detectUsedAngles(text))
  );

  const doNotRepeat = [];

  if (alreadyAskedQuestions.length) doNotRepeat.push('repeat_same_question');
  if (alreadyUsedAngles.includes('selection help')) doNotRepeat.push('repeat_selection_help');
  if (alreadyUsedAngles.includes('price push')) doNotRepeat.push('repeat_price_push');
  if (alreadySentTopics.includes('model recommendation')) doNotRepeat.push('repeat_model_recommendation');

  return {
    already_asked_questions: alreadyAskedQuestions,
    already_sent_topics: alreadySentTopics,
    already_used_angles: alreadyUsedAngles,
    do_not_repeat: uniqueNonEmpty(doNotRepeat)
  };
}

module.exports = { detectForbiddenRepeats };
