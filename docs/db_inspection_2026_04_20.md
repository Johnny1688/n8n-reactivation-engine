# Database Inspection - 2026-04-20

Pre-implementation check for Customer Profile subsystem.

## Query 1: conversation_summary & summary_updated_at field types

```sql
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'pipeline_state'
  AND column_name IN ('conversation_summary', 'summary_updated_at');
```

### Result:
[
  {
    "column_name": "summary_updated_at",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "conversation_summary",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES",
    "column_default": "''::text"
  }
]

## Query 2: existing indexes on pipeline_state

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'pipeline_state'
ORDER BY indexname;
```

### Result:
[
  {
    "indexname": "pipeline_state_pkey",
    "indexdef": "CREATE UNIQUE INDEX pipeline_state_pkey ON public.pipeline_state USING btree (id)"
  },
  {
    "indexname": "pipeline_state_project_key_key",
    "indexdef": "CREATE UNIQUE INDEX pipeline_state_project_key_key ON public.pipeline_state USING btree (project_key)"
  }
]

## Query 3: full pipeline_state column list

```sql
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'pipeline_state'
ORDER BY ordinal_position;
```

### Result:
[
  {
    "column_name": "id",
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO"
  },
  {
    "column_name": "project_key",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "customer_name",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "stage",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "status",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "last_customer_message_time",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "last_my_message_time",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "last_interaction_time",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "needs_follow_up",
    "data_type": "boolean",
    "udt_name": "bool",
    "is_nullable": "YES"
  },
  {
    "column_name": "follow_up_priority",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "notes",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "updated_at",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "days_since_last_customer_message",
    "data_type": "integer",
    "udt_name": "int4",
    "is_nullable": "YES"
  },
  {
    "column_name": "days_since_last_my_message",
    "data_type": "integer",
    "udt_name": "int4",
    "is_nullable": "YES"
  },
  {
    "column_name": "intent_score",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "last_followed_up_at",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "conversation_summary",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "summary_updated_at",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "follow_up_count",
    "data_type": "integer",
    "udt_name": "int4",
    "is_nullable": "YES"
  },
  {
    "column_name": "next_follow_up_at",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "follow_up_bucket",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "reactivation_bucket",
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "reactivation_at",
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES"
  },
  {
    "column_name": "message_count",
    "data_type": "integer",
    "udt_name": "int4",
    "is_nullable": "YES"
  }
]

## Query 4: existing triggers on pipeline_state

```sql
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'pipeline_state';
```

### Result:
[
  {
    "trigger_name": "preserve_protected_stages",
    "event_manipulation": "UPDATE",
    "action_timing": "BEFORE",
    "action_statement": "EXECUTE FUNCTION protect_stage()"
  }
]

## Findings & Decisions

1. **conversation_summary is TEXT** — current type is `text` with default `''::text`. Must migrate to `jsonb` before creating GIN indexes or storing structured profiles. Migration file: `migrations/20260420_1000_convert_conversation_summary_to_jsonb.sql`.

2. **summary_updated_at is timestamptz, nullable** — matches spec §4 expectations. No change needed.

3. **All 5 btree expression indexes are missing** — only `pipeline_state_pkey` (btree on id) and `pipeline_state_project_key_key` (btree unique on project_key) exist. All 5 indexes from spec §2 must be created after the jsonb migration. Migration file: `migrations/20260420_1001_customer_profile_indexes.sql`.

4. **preserve_protected_stages trigger exists** — BEFORE UPDATE, calls `protect_stage()`. Only guards stage field transitions (quoted/ready/closed_* cannot be downgraded by automation). No conflict with profile writes, which touch `conversation_summary` and `summary_updated_at` only.

## Execution Log 2026-04-20

- Pre-check (Option 1) — 0 rows returned, safe to proceed
- Migration A 第一次执行失败 — ERROR 0A000: today_followups_100_v2 has view dependency. Transaction auto-rolled back, no data loss.
- 补查依赖 — 发现 today_followups_100 (额外漏掉的视图, wrapper of followup_candidates with LIMIT 100). 第一次 pg_depend 查询只查了对 conversation_summary 列的直接依赖,没查视图间依赖。
- Migration A 第二次执行成功 (添加了 today_followups_100 到 DROP 和 CREATE 流程) — 视图全部恢复,数据无损
- Schema 验证: conversation_summary 现为 jsonb, default NULL; summary_updated_at 仍为 timestamptz nullable
- Migration B (5 个索引) 执行成功 — idx_profile_value_tier, idx_profile_decision_horizon, idx_profile_country, idx_profile_sample_status, idx_profile_has_return_history
- 索引类型: btree 表达式索引 (不是 GIN —— 见 customer_profile_system.md §2 修正)
- 备份表 _backup_conversation_summary_20260420 保留至 2026-04-27 后手动 DROP