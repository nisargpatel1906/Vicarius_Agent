-- Vicarius Agent Database Schema
-- Sourced from PRD_academic_task_agent.md (Sections 5 & 11)

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gmail', 'classroom')),
  external_id text not null,
  course text,
  title text not null,
  task_type text not null check (task_type in (
    'document', 'presentation', 'handwritten', 'code_project', 'research', 'ml_training'
  )),
  extracted_requirements jsonb,
  success_criteria text,
  build_spec text,
  due_date timestamptz,
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

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  question_text text not null,
  answer_text text,
  status text not null default 'pending' check (status in ('pending', 'answered', 'timed_out')),
  asked_at timestamptz not null default now(),
  answered_at timestamptz
);

create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  file_name text not null,
  drive_link text,
  file_type text,
  delivered_via text check (delivered_via in ('email', 'telegram', 'both')),
  delivered_at timestamptz not null default now()
);

create table if not exists system_events (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('info', 'warning', 'error')),
  component text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- Performance Indexes
create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_due_date on tasks (due_date);
create index if not exists idx_tasks_archived on tasks (archived);
create index if not exists idx_questions_task_id on questions (task_id);
create index if not exists idx_questions_status on questions (status);
create index if not exists idx_deliverables_task_id on deliverables (task_id);
create index if not exists idx_system_events_created_at on system_events (created_at desc);

-- Enable Row Level Security (RLS) on all tables (PRD Section 5 & 11)
alter table tasks enable row level security;
alter table questions enable row level security;
alter table deliverables enable row level security;
alter table system_events enable row level security;

-- RLS Policies
create policy "Allow all access to tasks" on tasks
  for all using (true) with check (true);

create policy "Allow all access to questions" on questions
  for all using (true) with check (true);

create policy "Allow all access to deliverables" on deliverables
  for all using (true) with check (true);

create policy "Allow all access to system_events" on system_events
  for all using (true) with check (true);

-- Chat History
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_chat_id on chat_messages (chat_id, created_at asc);

alter table chat_messages enable row level security;

create policy "Allow all access to chat_messages" on chat_messages
  for all using (true) with check (true);
