-- ==============================================================================
-- Vicarius Agent: Universal Database Schema & Row-Level Security
-- Execute this file once in your Supabase SQL Editor to initialize all tables.
-- ==============================================================================

-- 1. Profile Table (Student Identity & Academic Settings)
create table if not exists public.profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  full_name text not null default 'Student',
  preferred_name text,
  email text,
  phone text,
  telegram_id text,
  enrollment_no text,
  university text not null default 'Academic Institution',
  department text,
  program text not null default 'Undergraduate Degree',
  degree text,
  current_semester text not null default 'Semester 1',
  graduation_year text,
  cgpa_or_target_grade text,
  default_citation_style text not null default 'IEEE',
  writing_voice_sample text,
  academic_level_note text,
  bio text,
  skills jsonb default '[]'::jsonb,
  research_interests jsonb default '[]'::jsonb,
  custom_instructions text,
  custom_attributes jsonb default '{}'::jsonb,
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_profile_user_id on public.profile (user_id) where user_id is not null;

-- Helper to resolve owner ID for default column values
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

-- 2. Tasks Table (Academic Coursework, Papers & Projects)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  source text not null check (source in ('gmail', 'classroom', 'manual')),
  external_id text not null,
  course text,
  title text not null,
  task_type text not null check (task_type in (
    'document', 'presentation', 'handwritten', 'code_project', 'research', 'ml_training'
  )),
  weight text not null default 'light' check (weight in ('light', 'medium', 'heavy')),
  progress_note text,
  last_progress_at timestamptz,
  extracted_requirements jsonb,
  success_criteria text,
  build_spec text,
  due_date timestamptz,
  posted_date timestamptz default now(),
  status text not null default 'new' check (status in (
    'new', 'extracting', 'queued', 'claimed', 'building',
    'verifying', 'flagged', 'done', 'failed'
  )),
  worker_id text,
  claimed_at timestamptz,
  result_summary text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists idx_tasks_user_id on public.tasks (user_id);
create index if not exists idx_tasks_status on public.tasks (status);
create index if not exists idx_tasks_due_date on public.tasks (due_date);
create index if not exists idx_tasks_archived on public.tasks (archived);

-- 3. Questions Table (Interactive Human-in-the-Loop Clarifications)
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  question_text text not null,
  answer_text text,
  status text not null default 'pending' check (status in ('pending', 'answered', 'timed_out')),
  asked_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists idx_questions_user_id on public.questions (user_id);
create index if not exists idx_questions_task_id on public.questions (task_id);
create index if not exists idx_questions_status on public.questions (status);

-- 4. Deliverables Table (Completed Artifacts, Drive Links & Submissions)
create table if not exists public.deliverables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  drive_link text,
  file_type text,
  delivered_via text check (delivered_via in ('email', 'telegram', 'both')),
  delivered_at timestamptz not null default now()
);

create index if not exists idx_deliverables_user_id on public.deliverables (user_id);
create index if not exists idx_deliverables_task_id on public.deliverables (task_id);

-- 5. System Events Table (Structured Pipeline Auditing)
create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  level text not null check (level in ('info', 'warning', 'error')),
  component text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_events_user_id on public.system_events (user_id);
create index if not exists idx_system_events_created_at on public.system_events (created_at desc);

-- 6. Chat History Table (Interactive Web & Telegram Dialogue)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  chat_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_user_id on public.chat_messages (user_id);
create index if not exists idx_chat_messages_chat_id on public.chat_messages (chat_id, created_at asc);

-- 7. Knowledge Base & Vector Embeddings
create table if not exists public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  title text not null,
  content text not null,
  source text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_base_user_id on public.knowledge_base (user_id);

create table if not exists public.classroom_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default public.default_owner_id(),
  course_id text,
  course_name text,
  announcement_id text,
  chunk_text text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_classroom_chunks_user_id on public.classroom_knowledge_chunks (user_id);

-- 8. Encrypted Google OAuth Storage (Accessible only to backend service_role)
create table if not exists public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scopes text[],
  updated_at timestamptz not null default now()
);

-- ==============================================================================
-- Row-Level Security Policies (Strict Owner Isolation)
-- ==============================================================================

alter table public.profile enable row level security;
alter table public.tasks enable row level security;
alter table public.questions enable row level security;
alter table public.deliverables enable row level security;
alter table public.system_events enable row level security;
alter table public.chat_messages enable row level security;
alter table public.knowledge_base enable row level security;
alter table public.classroom_knowledge_chunks enable row level security;
alter table public.google_credentials enable row level security;

-- Revoke all direct client access from google_credentials (service_role only)
revoke all on public.google_credentials from anon, authenticated;

-- Owner policies for profile
create policy owner_select on public.profile for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.profile for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.profile for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.profile for delete to authenticated using (user_id = auth.uid());

-- Owner policies for tasks
create policy owner_select on public.tasks for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.tasks for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.tasks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.tasks for delete to authenticated using (user_id = auth.uid());

-- Owner policies for questions
create policy owner_select on public.questions for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.questions for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.questions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.questions for delete to authenticated using (user_id = auth.uid());

-- Owner policies for deliverables
create policy owner_select on public.deliverables for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.deliverables for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.deliverables for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.deliverables for delete to authenticated using (user_id = auth.uid());

-- Owner policies for system_events
create policy owner_select on public.system_events for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.system_events for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.system_events for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.system_events for delete to authenticated using (user_id = auth.uid());

-- Owner policies for chat_messages
create policy owner_select on public.chat_messages for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.chat_messages for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.chat_messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.chat_messages for delete to authenticated using (user_id = auth.uid());

-- Owner policies for knowledge_base
create policy owner_select on public.knowledge_base for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.knowledge_base for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.knowledge_base for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.knowledge_base for delete to authenticated using (user_id = auth.uid());

-- Owner policies for classroom_knowledge_chunks
create policy owner_select on public.classroom_knowledge_chunks for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.classroom_knowledge_chunks for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.classroom_knowledge_chunks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.classroom_knowledge_chunks for delete to authenticated using (user_id = auth.uid());

-- ==============================================================================
-- Triggers & Ownership Helpers
-- ==============================================================================

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
      'Academic Institution', 'Undergraduate Degree', 'Semester 1', 'IEEE', now()
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.claim_unowned_rows(owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t text;
begin
  if exists (select 1 from public.profile where user_id is null) then
    if not exists (select 1 from public.profile where user_id = owner) then
      update public.profile
      set user_id = owner, updated_at = now()
      where id = (
        select id from public.profile where user_id is null order by created_at asc nulls last limit 1
      );
    end if;
  end if;

  foreach t in array array['tasks','questions','deliverables','system_events','chat_messages','knowledge_base','classroom_knowledge_chunks']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('update public.%I set user_id = $1 where user_id is null', t) using owner;
    end if;
  end loop;
end $$;

revoke all on function public.claim_unowned_rows(uuid) from public, anon, authenticated;
