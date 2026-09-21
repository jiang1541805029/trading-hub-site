-- Trading Hub v36.2 incremental migration.
-- Run once if migrate_to_trade_rows.sql was already executed before v36.2.

begin;

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

-- Repair legacy rows that were defaulted to trend although their pattern has
-- an unambiguous non-trend category. Genuine trend patterns are untouched.
update public.trades
set trade_category = case
  when trade_pattern in ('双顶/双底', '三推反转', '楔形反转', '高潮反转') then '反转交易'
  when trade_pattern in ('区间高抛低吸', '区间边界反转', '区间内二次入场', '区间假突破') then '区间交易'
  when trade_pattern in ('区间突破', '趋势线突破', '旗形突破', '开盘区间突破') then '突破交易'
  when trade_pattern in ('缺口回补', '缺口延续', '缺口反转') then '缺口交易'
  else trade_category
end
where trade_pattern in (
  '双顶/双底', '三推反转', '楔形反转', '高潮反转',
  '区间高抛低吸', '区间边界反转', '区间内二次入场', '区间假突破',
  '区间突破', '趋势线突破', '旗形突破', '开盘区间突破',
  '缺口回补', '缺口延续', '缺口反转'
);

commit;
