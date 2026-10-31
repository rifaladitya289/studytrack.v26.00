-- StudyTrack X: private per-user snapshot backup for existing local workspace data.
-- Applied to the connected Supabase project on 2026-10-31.
-- Client access is restricted to the authenticated owner by RLS.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_state_payload_size check (octet_length(payload::text) < 4000000)
);
alter table public.user_state enable row level security;
revoke all on table public.user_state from anon;
grant select, insert, update on table public.user_state to authenticated;

drop policy if exists "user_state_select_own" on public.user_state;
create policy "user_state_select_own" on public.user_state
  for select to authenticated using ((select auth.uid()));

drop policy if exists "user_state_insert_own" on public.user_state;
create policy "user_state_insert_own" on public.user_state
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "user_state_update_own" on public.user_state;
create policy "user_state_update_own" on public.user_state
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function private.touch_user_state_updated_at()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_state_touch_updated_at on public.user_state;
create trigger user_state_touch_updated_at
before update on public.user_state
for each row execute function private.touch_user_state_updated_at();
