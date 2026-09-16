-- Run this once in the Supabase SQL Editor.
-- It guarantees that authenticated users can only access their own journal row.

alter table public.trade_journal enable row level security;

drop policy if exists "trade_journal_select_own" on public.trade_journal;
drop policy if exists "trade_journal_insert_own" on public.trade_journal;
drop policy if exists "trade_journal_update_own" on public.trade_journal;
drop policy if exists "trade_journal_delete_own" on public.trade_journal;

create policy "trade_journal_select_own"
on public.trade_journal
for select
to authenticated
using (auth.uid() = user_id);

create policy "trade_journal_insert_own"
on public.trade_journal
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "trade_journal_update_own"
on public.trade_journal
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "trade_journal_delete_own"
on public.trade_journal
for delete
to authenticated
using (auth.uid() = user_id);
