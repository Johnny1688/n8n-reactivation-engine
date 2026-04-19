# n8n Workflow Nodes Code Snapshot
> Last updated: 2026-04-19

## Workflow 1: WhatsApp Incoming Message

### Node: Unique Pipeline State (Code Node — JavaScript)

```javascript
const map = new Map();
const now = new Date();

function normalizeTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function diffDays(fromTime) {
  if (!fromTime) return null;
  const from = new Date(fromTime);
  if (isNaN(from.getTime())) return null;
  const diff = Math.floor((now - from) / (1000 * 60 * 60 * 24));
  return diff < 0 ? 0 : diff;
}

function pickLatest(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a) > new Date(b) ? a : b;
}

for (const item of items) {
  const row = item.json;
  const key = row.project_key || row.chat_id || row.customer_name;

  if (!key) continue;

  const existing = map.get(key);

  const time = normalizeTime(row.message_time);
  const syncedAt = normalizeTime(row.synced_at);
  const role = row.role || "";
  const customerName = row.customer_name || "";

  if (!existing) {
    map.set(key, {
      project_key: key,
      customer_name: customerName || key,
      stage: "new",
      status: "open",
      intent_score: row.intent_score || "low",
      last_customer_message_time: role === "customer" ? time : null,
      last_my_message_time: role === "me" ? time : null,
      last_interaction_time: time,
      needs_follow_up: false,
      follow_up_priority: "normal",
      days_since_last_customer_message: null,
      days_since_last_my_message: null,
      last_followed_up_at: row.last_followed_up_at || null,
      notes: row.notes || "",
      updated_at: syncedAt || time || new Date().toISOString(),
    });
    continue;
  }

  if (
    role === "customer" &&
    time &&
    (!existing.last_customer_message_time || time > existing.last_customer_message_time)
  ) {
    existing.last_customer_message_time = time;
  }

  if (
    role === "me" &&
    time &&
    (!existing.last_my_message_time || time > existing.last_my_message_time)
  ) {
    existing.last_my_message_time = time;
  }

  if (
    time &&
    (!existing.last_interaction_time || time > existing.last_interaction_time)
  ) {
    existing.last_interaction_time = time;
  }

  if (!existing.customer_name && customerName) {
    existing.customer_name = customerName;
  }

  if (!existing.intent_score && row.intent_score) {
    existing.intent_score = row.intent_score;
  }

  if (!existing.last_followed_up_at && row.last_followed_up_at) {
    existing.last_followed_up_at = row.last_followed_up_at;
  }

  if ((!existing.notes || existing.notes === "") && row.notes) {
    existing.notes = row.notes;
  }

  existing.updated_at = pickLatest(existing.updated_at, syncedAt || time);
}

for (const entry of map.values()) {
  const hasCustomerMsg = entry.last_customer_message_time !== null;
  const hasMyMsg = entry.last_my_message_time !== null;

  entry.days_since_last_customer_message = diffDays(entry.last_customer_message_time);
  entry.days_since_last_my_message = diffDays(entry.last_my_message_time);

  const daysSinceLastInteraction = diffDays(entry.last_interaction_time);

  const customerTime = hasCustomerMsg
    ? new Date(entry.last_customer_message_time).getTime()
    : null;

  const myTime = hasMyMsg
    ? new Date(entry.last_my_message_time).getTime()
    : null;

  const hasFollowedUpAlready = entry.last_followed_up_at !== null;

  entry.status = "open";
  entry.intent_score = entry.intent_score || "low";
  entry.last_followed_up_at = entry.last_followed_up_at || null;
  entry.notes = entry.notes || "";
  entry.needs_follow_up = false;
  entry.follow_up_priority = "normal";

  // 强制重置 stage
  entry.stage = "new";

  // stage 自动升级
  if (!hasCustomerMsg && hasMyMsg) {
    entry.stage = "outreach";
  } else if (hasCustomerMsg && !hasMyMsg) {
    entry.stage = "new";
  } else if (hasCustomerMsg && hasMyMsg) {
    if (daysSinceLastInteraction !== null && daysSinceLastInteraction > 14) {
      entry.stage = "stalled";
    } else {
      entry.stage = "engaged";
    }
  } else {
    entry.stage = "new";
  }

  // follow-up 逻辑

  // 1. 客户发过,我没回
  if (customerTime !== null && myTime === null) {
    entry.needs_follow_up = true;
    entry.follow_up_priority =
      entry.days_since_last_customer_message >= 1 ? "high" : "medium";
  }

  // 2. 客户最后发言
  else if (customerTime !== null && myTime !== null && customerTime > myTime) {
    entry.needs_follow_up = true;
    entry.follow_up_priority =
      entry.days_since_last_customer_message >= 1 ? "high" : "medium";
  }

  // 3. 我最后发言 → 客户沉默
  else if (customerTime !== null && myTime !== null && myTime > customerTime) {
    if (hasFollowedUpAlready) {
      entry.needs_follow_up = false;  // ⚠️ BUG: 永久失效
    } else if (entry.days_since_last_my_message >= 3) {
      entry.needs_follow_up = true;
      entry.follow_up_priority =
        entry.days_since_last_my_message >= 7 ? "high" : "medium";
    }
  }

  // 4. 只有我发过 → 持续开发
  else if (customerTime === null && myTime !== null) {
    if (!hasFollowedUpAlready && entry.days_since_last_my_message >= 3) {
      entry.needs_follow_up = true;
      entry.follow_up_priority =
        entry.days_since_last_my_message >= 7 ? "medium" : "low";
    }
  }

  entry.updated_at = entry.updated_at || new Date().toISOString();
}

return Array.from(map.values()).map(row => ({ json: row }));
```

**⚠️ 已知 Bug**:
1. `entry.stage = "new"` 强制重置 → quoted/ready 标签会被覆盖
2. `if (hasFollowedUpAlready) { needs_follow_up = false }` → 永久失效

**HTTP Request 后续节点**: POST 到 Vercel `/api/pipeline-state`

---

### Node: AI Follow-up Candidates (Code Node — JavaScript)

```javascript
const candidates = items.filter(item => {
  const row = item.json || {};
  const now = new Date();
  const next = row.next_follow_up_at ? new Date(row.next_follow_up_at) : null;
  return (
    row.status === 'open' &&
    row.needs_follow_up === true &&
    next &&
    now >= next
  );
});

if (candidates.length === 0) {
  return [{ json: { __no_candidate: true } }];
}
return candidates;
```

简单过滤器:筛出 status=open + needs_follow_up=true + next_follow_up_at 已到期的客户。

---

## today_followups_100 视图定义

```sql
SELECT id, project_key, customer_name, stage, status,
    last_customer_message_time, last_my_message_time, last_interaction_time,
    needs_follow_up, follow_up_priority, notes, updated_at,
    EXTRACT(day FROM now() - last_customer_message_time)::integer AS days_since_last_customer_message,
    EXTRACT(day FROM now() - last_my_message_time)::integer AS days_since_last_my_message,
    intent_score, last_followed_up_at, conversation_summary, summary_updated_at,
    follow_up_count, next_follow_up_at,
    follow_up_bucket, reactivation_bucket, reactivation_at,
    message_count
FROM pipeline_state
WHERE needs_follow_up = true 
  AND status NOT IN ('closed_won', 'closed_lost')
  AND (
    follow_up_priority = 'high' AND last_my_message_time < (now() - '5 days'::interval) 
    OR follow_up_priority = 'medium' AND last_my_message_time < (now() - '7 days'::interval) 
    OR (follow_up_priority IS NULL OR follow_up_priority NOT IN ('high', 'medium')) 
       AND last_my_message_time < (now() - '14 days'::interval)
  ) 
  AND (follow_up_count IS NULL OR follow_up_count < 4) 
  AND (last_customer_message_time IS NULL 
       OR last_my_message_time IS NULL 
       OR last_customer_message_time < last_my_message_time)
ORDER BY 
  CASE follow_up_priority
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    ELSE 3
  END, 
  next_follow_up_at NULLS FIRST
LIMIT 100;
```

## HTTP Endpoints (Vercel)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/pipeline-state` | POST | 写入/更新 pipeline_state |
| `/api/pipeline-state2` | PATCH | 局部更新(follow_up 字段) |
| `/api/contacts` | POST | 写入/更新 contacts |
| `/api/chat-state` | POST | 写入/更新 chat_state |
| `/api/messages` | POST | 写入 messages |
| `/api/build-context` | POST | 构建激活 prompt 上下文 |
| `/api/compile-enforce-prompt` | POST | 编译 Enforce 阶段 prompt |
| `/api/filter-and-format-telegram-final` | POST | 过滤格式化最终消息 |
| `/api/split-telegram-messages` | POST | 拆分 3 条 Telegram 消息 |