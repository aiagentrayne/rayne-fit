-- ROSS AI coaching: vision, milestones, check-ins, journal, weekly/monthly measurables,
-- coaching sessions, proposals, nuggets, coaching memory and AI usage logs.
--
-- Same security model as the initial schema: every table has user_id and row-level security;
-- signed-in clients may only SELECT their own rows, and all writes go through server routes.
-- This migration is additive only: existing tables keep every row and column.

-- ---------------------------------------------------------------- measurables: cadence
-- 'daily'  = the existing behaviour (YES/NO on scheduled days, counted in the day score).
-- 'weekly' / 'monthly' = a target count per period, logged on any day, graded only at the
--            period level and never counted in the daily score.
alter table public.item_versions
  add column cadence text not null default 'daily' check (cadence in ('daily', 'weekly', 'monthly')),
  add column target_count smallint check (target_count between 1 and 31),
  add column milestone_id uuid,
  add column changed_by_proposal uuid;
alter table public.item_versions
  add constraint item_versions_target_ck check (cadence = 'daily' or target_count is not null);

-- ---------------------------------------------------------------- settings
alter table public.user_settings
  add column ross_enabled boolean not null default false,
  add column ross_consent_at timestamptz,
  add column ross_share_checkins boolean not null default true,
  add column ross_share_journal boolean not null default false,
  add column nugget_enabled boolean not null default true,
  add column nugget_window_start text not null default '06:00' check (nugget_window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column nugget_window_end text not null default '09:00' check (nugget_window_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column checkin_reminders_enabled boolean not null default true,
  add column morning_checkin_time text not null default '07:15' check (morning_checkin_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column morning_followup_time text not null default '10:00' check (morning_followup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column weekly_interview_dow smallint not null default 7 check (weekly_interview_dow between 1 and 7),
  add column weekly_interview_time text not null default '18:00' check (weekly_interview_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column monthly_interview_enabled boolean not null default true,
  add column quarterly_review_enabled boolean not null default true,
  add column ross_max_daily_notifications smallint not null default 2 check (ross_max_daily_notifications between 1 and 4),
  add column ross_quiet_start text not null default '22:00' check (ross_quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column ross_quiet_end text not null default '06:00' check (ross_quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ---------------------------------------------------------------- notification kinds
alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check check (kind in (
  'reminder', 'nudge', 'deadline', 'snooze', 'evening', 'weekly_summary', 'monthly_summary', 'test',
  'nugget', 'checkin_morning', 'interview_due', 'interview_overdue'));
alter table public.notification_queue add column session_id uuid;

-- ---------------------------------------------------------------- check-ins and journal
-- Ratings run 1 = difficult/poor state ... 5 = favourable state for every metric.
-- A missing row means "not recorded"; nothing is ever filled in automatically.
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  metric text not null check (metric in ('energy', 'mood', 'stress')),
  rating smallint not null check (rating between 1 and 5),
  note text check (char_length(note) <= 500),
  timezone text not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual')),
  late boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, local_date, metric)
);
create index checkins_user_date_idx on public.checkins (user_id, local_date);

create table public.journal_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- ---------------------------------------------------------------- weekly / monthly measurable logs
create table public.measurable_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  local_date date not null,
  mutation_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, mutation_id)
);
create index measurable_logs_item_date_idx on public.measurable_logs (user_id, item_id, local_date);

-- ---------------------------------------------------------------- vision and milestones
-- Versioned: revising the vision inserts a new row and marks the old one superseded.
create table public.visions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null,
  identity text not null check (char_length(identity) <= 2000),
  statement text not null check (char_length(statement) <= 4000),
  one_year text not null default '' check (char_length(one_year) <= 2000),
  five_year text not null default '' check (char_length(five_year) <= 2000),
  status text not null default 'active' check (status in ('active', 'superseded')),
  source text not null default 'user' check (source in ('user', 'proposal')),
  proposal_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);
create unique index visions_one_active_idx on public.visions (user_id) where status = 'active';

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  detail text check (char_length(detail) <= 1000),
  horizon text not null default '1y' check (horizon in ('1y', '5y', 'other')),
  target_date date,
  status text not null default 'active' check (status in ('active', 'achieved', 'dropped')),
  source text not null default 'user' check (source in ('user', 'proposal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index milestones_user_idx on public.milestones (user_id, status);

-- ---------------------------------------------------------------- coaching sessions
create table public.coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('vision', 'weekly', 'monthly', 'quarterly', 'nugget_chat')),
  period_start date,
  period_end date,
  due_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'missed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  reschedule_count integer not null default 0,
  summary text,
  user_turns integer not null default 0,
  nugget_id uuid,
  safety_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index coaching_sessions_period_idx on public.coaching_sessions (user_id, kind, period_start)
  where kind in ('weekly', 'monthly', 'quarterly');
create index coaching_sessions_user_status_idx on public.coaching_sessions (user_id, status, due_at);

create table public.coaching_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.coaching_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  via_voice boolean not null default false,
  created_at timestamptz not null default now()
);
create index coaching_messages_session_idx on public.coaching_messages (session_id, created_at);
create index coaching_messages_created_idx on public.coaching_messages (created_at);

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.coaching_sessions (id) on delete set null,
  text text not null check (char_length(text) between 1 and 500),
  due_date date,
  status text not null default 'proposed' check (status in ('proposed', 'open', 'kept', 'missed', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commitments_user_idx on public.commitments (user_id, status);

-- ROSS never edits measurables, milestones or the vision directly. It files a proposal;
-- only the user's explicit approval (re-validated on the server) applies it.
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.coaching_sessions (id) on delete set null,
  kind text not null check (kind in ('create_measurable', 'edit_measurable', 'archive_measurable', 'create_milestone', 'edit_milestone', 'update_vision')),
  payload jsonb not null,
  rationale text not null default '' check (char_length(rationale) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index proposals_user_status_idx on public.proposals (user_id, status);

-- ---------------------------------------------------------------- daily nuggets
create table public.nuggets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  category text not null check (category in ('accountability', 'educational', 'motivational')),
  body text not null check (char_length(body) <= 600),
  grounding jsonb not null default '[]'::jsonb,
  model text,
  fallback boolean not null default false,
  scheduled_for timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, local_date)
);

-- ---------------------------------------------------------------- coaching memory
create table public.coaching_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('obstacle', 'strategy', 'preference', 'fact')),
  text text not null check (char_length(text) between 1 and 500),
  source_session_id uuid references public.coaching_sessions (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  edited_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coaching_memory_user_idx on public.coaching_memory (user_id, status);

-- ---------------------------------------------------------------- AI usage and safety logs (no message text)
create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6),
  latency_ms integer,
  outcome text not null,
  created_at timestamptz not null default now()
);
create index ai_calls_user_created_idx on public.ai_calls (user_id, created_at);
create index ai_calls_created_idx on public.ai_calls (created_at);

create table public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.coaching_sessions (id) on delete set null,
  source text not null check (source in ('interview', 'journal', 'model_flag')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- row-level security
do $$
declare t text;
begin
  foreach t in array array['checkins','journal_entries','measurable_logs','visions','milestones','coaching_sessions',
    'coaching_messages','commitments','proposals','nuggets','coaching_memory','ai_calls','safety_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select_own', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;
