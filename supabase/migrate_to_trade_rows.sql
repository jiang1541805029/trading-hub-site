-- Trading Hub v36.0 migration
-- Run the complete script once in the Supabase SQL Editor before publishing v36.0.
-- The legacy public.trade_journal table is intentionally preserved as a backup.

begin;

create table if not exists public.trades (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  trade_date date not null,
  trade_timestamp bigint not null,
  ticker text not null,
  order_type text not null check (order_type in ('止损单', '限价单', '市价单', '未记录')),
  trade_category text not null,
  trade_pattern text not null,
  pnl numeric not null default 0,
  currency text not null default 'USD' check (currency in ('USD', 'CNY', 'SGD')),
  snapshot_id text,
  review text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists trades_user_date_idx
  on public.trades (user_id, trade_date desc);

create index if not exists trades_user_timestamp_idx
  on public.trades (user_id, trade_timestamp desc);

-- Copy every object from the legacy per-user JSON array into its own row.
insert into public.trades (
  user_id, id, trade_date, trade_timestamp, ticker, order_type,
  trade_category, trade_pattern, pnl, currency, snapshot_id, review,
  created_at, updated_at
)
select
  journal.user_id,
  coalesce(nullif(item.value->>'id', ''), md5(journal.user_id::text || item.ordinality::text)),
  case
    when pg_input_is_valid(coalesce(item.value->>'dateStr', ''), 'date')
      then (item.value->>'dateStr')::date
    else current_date
  end,
  case
    when coalesce(item.value->>'timestamp', '') ~ '^\d+$'
      then (item.value->>'timestamp')::bigint
    else (extract(epoch from coalesce(journal.updated_at, now())) * 1000)::bigint
  end,
  upper(coalesce(nullif(item.value->>'ticker', ''), 'UNKNOWN')),
  case
    when item.value->>'orderType' in ('止损单', '限价单', '市价单', '未记录')
      then item.value->>'orderType'
    else '未记录'
  end,
  coalesce(
    nullif(item.value->>'tradeCategory', ''),
    case
      when coalesce(item.value->>'tradePattern', item.value->>'strategy', '') in ('双顶/双底', '三推反转', '楔形反转', '高潮反转') then '反转交易'
      when coalesce(item.value->>'tradePattern', item.value->>'strategy', '') in ('区间高抛低吸', '区间边界反转', '区间内二次入场', '区间假突破') then '区间交易'
      when coalesce(item.value->>'tradePattern', item.value->>'strategy', '') in ('区间突破', '趋势线突破', '旗形突破', '开盘区间突破') then '突破交易'
      when coalesce(item.value->>'tradePattern', item.value->>'strategy', '') in ('缺口回补', '缺口延续', '缺口反转') then '缺口交易'
      when coalesce(item.value->>'tradePattern', item.value->>'strategy', '') in ('高1/低1', '高2/低2', '高3/低3', '均线回踩', '50%回调', '突破后回测') then '趋势交易'
      else '未分类'
    end
  ),
  coalesce(nullif(item.value->>'tradePattern', ''), nullif(item.value->>'strategy', ''), '未记录'),
  case
    when pg_input_is_valid(trim(coalesce(item.value->>'pnl', '')), 'numeric')
      then trim(item.value->>'pnl')::numeric
    else 0
  end,
  case
    when item.value->>'currency' in ('USD', 'CNY', 'SGD') then item.value->>'currency'
    else 'USD'
  end,
  nullif(item.value->>'snapshotId', ''),
  coalesce(item.value->>'review', ''),
  coalesce(journal.updated_at, now()),
  coalesce(journal.updated_at, now())
from public.trade_journal as journal
cross join lateral jsonb_array_elements(journal.data::jsonb) with ordinality as item(value, ordinality)
on conflict (user_id, id) do nothing;

create or replace function public.set_trade_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trade_updated_at on public.trades;
create trigger set_trade_updated_at
before update on public.trades
for each row execute function public.set_trade_updated_at();

alter table public.trades enable row level security;

drop policy if exists "trades_select_own" on public.trades;
drop policy if exists "trades_insert_own" on public.trades;
drop policy if exists "trades_update_own" on public.trades;
drop policy if exists "trades_delete_own" on public.trades;

create policy "trades_select_own"
on public.trades for select to authenticated
using (auth.uid() = user_id);

create policy "trades_insert_own"
on public.trades for insert to authenticated
with check (auth.uid() = user_id);

create policy "trades_update_own"
on public.trades for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "trades_delete_own"
on public.trades for delete to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.trades to authenticated;

-- Atomically replace all rows for the signed-in user. Any invalid row rolls back
-- both the delete and insert, so imports cannot leave an empty cloud journal.
create or replace function public.replace_user_trades(p_trades jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_trades) is distinct from 'array' then
    raise exception 'p_trades must be a JSON array';
  end if;

  delete from public.trades where user_id = current_user_id;

  insert into public.trades (
    user_id, id, trade_date, trade_timestamp, ticker, order_type,
    trade_category, trade_pattern, pnl, currency, snapshot_id, review
  )
  select
    current_user_id, x.id, x.trade_date, x.trade_timestamp, x.ticker,
    x.order_type, x.trade_category, x.trade_pattern, x.pnl, x.currency,
    x.snapshot_id, coalesce(x.review, '')
  from jsonb_to_recordset(p_trades) as x(
    user_id uuid, id text, trade_date date, trade_timestamp bigint,
    ticker text, order_type text, trade_category text, trade_pattern text,
    pnl numeric, currency text, snapshot_id text, review text
  );
end;
$$;

revoke all on function public.replace_user_trades(jsonb) from public;
grant execute on function public.replace_user_trades(jsonb) to authenticated;

commit;

-- Optional verification after COMMIT:
-- select user_id, count(*) as trade_count from public.trades group by user_id;
