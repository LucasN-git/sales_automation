-- Phase 3: expected_count + chat_threads + chat fields

-- 1) Expected exhibitor count from discovery
alter table trade_shows
  add column if not exists expected_exhibitor_count int;

-- 2) Chat threads (multiple conversations per show, optionally focused on an exhibitor)
create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  trade_show_id uuid not null references trade_shows(id) on delete cascade,
  title text,
  exhibitor_focus uuid references exhibitors(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists idx_chat_threads_show on chat_threads (trade_show_id, last_message_at desc);

-- 3) chat_messages: thread_id + per-message metadata
alter table chat_messages
  add column if not exists thread_id uuid references chat_threads(id) on delete cascade,
  add column if not exists model text,
  add column if not exists with_deep_context boolean not null default false,
  add column if not exists with_web_search boolean not null default false;

create index if not exists idx_chat_thread_msgs on chat_messages (thread_id, created_at);

-- 4) RLS for chat_threads
alter table chat_threads enable row level security;

drop policy if exists "chat_threads_via_show" on chat_threads;
create policy "chat_threads_via_show"
  on chat_threads for all
  using (
    exists (select 1 from trade_shows ts where ts.id = chat_threads.trade_show_id and ts.user_id = auth.uid())
  )
  with check (
    exists (select 1 from trade_shows ts where ts.id = chat_threads.trade_show_id and ts.user_id = auth.uid())
  );

-- 5) updated_at trigger fuer chat_threads (last_message_at wird manuell gepflegt)
-- (no trigger; we update last_message_at explicitly when posting messages)

-- 6) Realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_threads'
  ) then
    alter publication supabase_realtime add table public.chat_threads;
  end if;
end $$;
