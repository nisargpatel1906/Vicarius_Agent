-- Migration: Create Knowledge Base for Vector Search

-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create the knowledge_base table
create table if not exists knowledge_base (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gmail', 'classroom')),
  external_id text not null,
  course text,
  title text not null,
  content text not null,
  embedding vector(768),
  metadata jsonb default '{}'::jsonb,
  posted_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, external_id)
);

-- Performance Indexes
create index if not exists idx_knowledge_base_course on knowledge_base (course);
create index if not exists idx_knowledge_base_source on knowledge_base (source);
create index if not exists idx_knowledge_base_posted_date on knowledge_base (posted_date);

-- HNSW index on embedding column for faster cosine distance similarity search
create index if not exists knowledge_base_embedding_idx on knowledge_base 
using hnsw (embedding vector_cosine_ops);

-- Enable RLS
alter table knowledge_base enable row level security;

-- Create policy to allow access
create policy "Allow all access to knowledge_base" on knowledge_base
  for all using (true) with check (true);

-- Create a function to search for matching knowledge
create or replace function match_knowledge(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_course text default null
)
returns table (
  id uuid,
  source text,
  external_id text,
  course text,
  title text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    kb.id,
    kb.source,
    kb.external_id,
    kb.course,
    kb.title,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) as similarity
  from knowledge_base kb
  where 1 - (kb.embedding <=> query_embedding) > match_threshold
    and (filter_course is null or kb.course = filter_course)
  order by kb.embedding <=> query_embedding
  limit match_count;
$$;
