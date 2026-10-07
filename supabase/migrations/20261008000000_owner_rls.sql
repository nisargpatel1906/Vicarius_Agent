-- ============================================================================
-- Migration: Owner-scoped Row Level Security + Google credential storage
-- Self-hosted, single-owner model:
--   * anon key (shipped to browsers) gets NO table access
--   * authenticated users only see/mutate rows they own (user_id = auth.uid())
--   * service_role (server routes + Python worker) bypasses RLS
-- ============================================================================

-- 1. Owner resolver used as a column default so existing insert code keeps working
create or replace function public.default_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.profile
  where user_id is not null
  order by created_at asc nulls last
  limit 1
$$;

-- 2. Ownership columns
do $$
declare t text;
begin
  foreach t in array array['tasks','questions','deliverables','system_events','chat_messages','knowledge_base','classroom_knowledge_chunks']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete cascade', t);
      execute format('alter table public.%I alter column user_id set default public.default_owner_id()', t);
      execute format('create index if not exists %I on public.%I (user_id)', 'idx_' || t || '_user_id', t);
    end if;
  end loop;
end $$;

create unique index if not exists uq_profile_user_id on public.profile (user_id) where user_id is not null;
alter table public.profile add column if not exists setup_completed boolean not null default false;

-- 3. Replace permissive policies with owner-scoped policies
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and policyname ilike 'Allow all access%'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profile','tasks','questions','deliverables','system_events','chat_messages','knowledge_base','classroom_knowledge_chunks']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists owner_select on public.%I', t);
      execute format('drop policy if exists owner_update on public.%I', t);
      execute format('drop policy if exists owner_insert on public.%I', t);
      execute format('drop policy if exists owner_delete on public.%I', t);
      execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
      execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
      execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
      execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- 4. Google OAuth refresh tokens (service_role only: RLS on, zero policies)
create table if not exists public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scopes text[],
  updated_at timestamptz not null default now()
);
alter table public.google_credentials enable row level security;
revoke all on public.google_credentials from anon, authenticated;

-- 5. Claim rows created before auth existed (called by /auth/callback for the allow-listed owner)
create or replace function public.claim_unowned_rows(owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t text;
begin
  -- For profile, update the oldest unowned profile row if exists
  if exists (select 1 from public.profile where user_id is null) then
    if not exists (select 1 from public.profile where user_id = owner) then
      update public.profile
      set user_id = owner, updated_at = now()
      where id = (
        select id from public.profile where user_id is null order by created_at asc nulls last limit 1
      );
    end if;
  end if;

  -- For all other tables, attach unowned rows to the owner
  foreach t in array array['tasks','questions','deliverables','system_events','chat_messages','knowledge_base','classroom_knowledge_chunks']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('update public.%I set user_id = $1 where user_id is null', t) using owner;
    end if;
  end loop;
end $$;
revoke all on function public.claim_unowned_rows(uuid) from public, anon, authenticated;

-- 6. Idempotent signup trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.profile where user_id is null) then
    update public.profile
    set user_id = new.id,
        email = coalesce(new.email, profile.email),
        updated_at = now()
    where id = (
      select id from public.profile where user_id is null order by created_at asc nulls last limit 1
    );
  else
    insert into public.profile (user_id, email, full_name, preferred_name, university, program, current_semester, default_citation_style, updated_at)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      coalesce(new.raw_user_meta_data->>'given_name', split_part(new.email, '@', 1)),
      '', '', '', 'IEEE', now()
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
