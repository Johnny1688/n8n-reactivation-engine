with ranked_candidates as materialized (
  select
    v3.*,
    row_number() over (
      order by
        v3.lane_priority asc nulls last,
        v3.rank_in_lane asc nulls last,
        v3.project_key collate "C" asc
    ) as original_order
  from public.followup_candidates_v3 as v3
  where v3.project_key is not null
    and btrim(v3.project_key) <> ''
    and v3.lane_priority is not null
    and v3.rank_in_lane is not null
    and not (
      lower(btrim(coalesce(v3.project_key, ''))) in (
        'facebook business',
        'facebook',
        'meta',
        'meta business'
      )
      or lower(btrim(coalesce(v3.customer_name, ''))) in (
        'facebook business',
        'facebook',
        'meta',
        'meta business'
      )
    )
),
top50 as materialized (
  select ranked_candidates.*
  from ranked_candidates
  order by ranked_candidates.original_order
  limit 50
),
enriched as materialized (
  select
    top50.*,
    phone_lookup.customer_phone,
    case
      when top50.customer_name ~ '澳大利亚|澳洲|新西兰|菲律宾' then 1
      when top50.project_key ~ '澳大利亚|澳洲|新西兰|菲律宾' then 1
      when phone_lookup.customer_phone like '+61%' then 1
      when phone_lookup.customer_phone like '+64%' then 1
      when phone_lookup.customer_phone like '+63%' then 1
      else 2
    end as country_priority
  from top50
  left join lateral (
    select c.customer_phone
    from public.contacts as c
    where c.project_key = top50.project_key
      and c.customer_phone is not null
    order by
      c.last_seen_at desc nulls last,
      c.created_at desc nulls last,
      c.customer_phone collate "C" asc
    limit 1
  ) as phone_lookup on true
)
select enriched.*
from enriched
order by enriched.country_priority, enriched.original_order;
