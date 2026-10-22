-- Rayne Fit accountability scorecard: initial schema.
--
-- Security model
--  * Supabase Auth owns identities (auth.users).
--  * Every table carries user_id and has row-level security enabled. Signed-in clients may
--    only SELECT their own rows; there are NO insert/update/delete policies for the
--    `authenticated` or `anon` roles. All writes go through the app's server routes, which
--    verify the session, validate input, and enforce scoring rules (server-authoritative).
--  * The server connects with a privileged database role (table owner), which bypasses RLS,
--    and always scopes queries by the verified user id.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- settings
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'America/New_York',
  cutoff_time text not null default '23:59' check (cutoff_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  week_start smallint not null default 1 check (week_start between 1 and 7),
  grade_thresholds jsonb not null default '[
    {"grade":"A+","min":97},{"grade":"A","min":93},{"grade":"A-","min":90},
    {"grade":"B+","min":87},{"grade":"B","min":83},{"grade":"B-","min":80},
    {"grade":"C+","min":77},{"grade":"C","min":73},{"grade":"C-","min":70},
    {"grade":"D+","min":67},{"grade":"D","min":63},{"grade":"D-","min":60},
    {"grade":"F","min":0}]'::jsonb,
  notifications_enabled boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_start text not null default '22:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end text not null default '07:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  evening_reminder_enabled boolean not null default true,
  evening_reminder_time text not null default '21:00' check (evening_reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekly_summary_enabled boolean not null default false,
  monthly_summary_enabled boolean not null default false,
  dashboard_prefs jsonb not null default '{}'::jsonb,
  -- First day that is scored. Days before this are never back-filled.
  scoring_start_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- items
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_user_idx on public.items (user_id, position);

-- Immutable definition versions. Every edit, (de)activation, archive or delete inserts a
-- new row. A day is governed by the latest version created at or before its cutoff.
create table public.item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  category text check (char_length(category) <= 60),
  schedule_type text not null check (schedule_type in ('daily', 'weekdays', 'weekends', 'custom')),
  days_of_week smallint[] not null default '{}',
  start_date date not null,
  end_date date,
  due_time text check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  is_active boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (item_id, version),
  check (end_date is null or end_date >= start_date),
  check (days_of_week <@ array[1,2,3,4,5,6,7]::smallint[])
);
create index item_versions_user_idx on public.item_versions (user_id, item_id, version desc);

-- Per-item notification rules.
create table public.item_notification_rules (
  item_id uuid primary key references public.items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  reminder_times text[] not null default '{}',
  before_due_minutes integer[] not null default '{}',
  nudge_offsets integer[] not null default '{}',
  deadline_warning_minutes integer check (deadline_warning_minutes between 1 and 720),
  snooze_minutes integer not null default 10 check (snooze_minutes between 1 and 240),
  reconsider_after_no boolean not null default false,
  custom_message text check (char_length(custom_message) <= 200),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- days
create table public.day_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  status text not null default 'open' check (status in ('open', 'final')),
  timezone text not null,
  cutoff_time text not null,
  cutoff_at timestamptz not null,
  applicable_count integer not null default 0,
  yes_count integer not null default 0,
  -- Full-precision percentage; null means N/A (nothing scheduled).
  score_pct double precision,
  grade text,
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date),
  check (yes_count between 0 and applicable_count)
);
create index day_records_open_idx on public.day_records (cutoff_at) where status = 'open';

-- Dated snapshot of each scheduled item for a day. Names are copied so that editing or
-- deleting an item never rewrites history. No FK to items on purpose.
create table public.day_items (
  user_id uuid not null,
  local_date date not null,
  item_id uuid not null,
  item_version_id uuid not null,
  name text not null,
  category text,
  due_time text,
  position integer not null default 0,
  response text check (response in ('yes', 'no')),
  responded_at timestamptz,
  response_source text check (response_source in ('app', 'notification', 'offline', 'correction', 'auto')),
  auto_finalized boolean not null default false,
  primary key (user_id, local_date, item_id),
  foreign key (user_id, local_date) references public.day_records (user_id, local_date) on delete cascade
);

-- Every check-in attempt, keyed by a client-generated mutation id for idempotency.
create table public.response_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mutation_id text not null check (char_length(mutation_id) between 8 and 120),
  local_date date not null,
  item_id uuid not null,
  value text check (value in ('yes', 'no')),
  source text not null,
  client_time timestamptz not null,
  received_at timestamptz not null default now(),
  outcome text not null,
  unique (user_id, mutation_id)
);

-- Audit trail of changes to finalized days.
create table public.corrections (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  item_id uuid not null,
  item_name text not null,
  old_value text,
  new_value text,
  old_score_pct double precision,
  new_score_pct double precision,
  kind text not null check (kind in ('correction', 'late_offline_sync')),
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index corrections_user_idx on public.corrections (user_id, created_at desc);

-- ---------------------------------------------------------------- notifications
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where disabled_at is null;

create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid,
  local_date date not null,
  kind text not null check (kind in ('reminder', 'nudge', 'deadline', 'snooze', 'evening', 'weekly_summary', 'monthly_summary', 'test')),
  scheduled_for timestamptz not null,
  -- Idempotency: planning the same notification twice is a no-op.
  dedupe_key text not null unique,
  title text not null,
  body text not null default '',
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'cancelled', 'suppressed', 'expired', 'failed')),
  status_reason text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_queue_due_idx on public.notification_queue (scheduled_for) where status = 'pending';
create index notification_queue_user_day_idx on public.notification_queue (user_id, local_date, item_id);

create table public.notification_attempts (
  id bigserial primary key,
  queue_id uuid not null references public.notification_queue (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  attempted_at timestamptz not null default now(),
  success boolean not null,
  status_code integer,
  error text
);
create index notification_attempts_queue_idx on public.notification_attempts (queue_id);

-- Users acting on a notification (Mark YES/NO, Snooze). Prevents double-processing taps.
create table public.notification_actions (
  queue_id uuid not null references public.notification_queue (id) on delete cascade,
  action text not null check (action in ('yes', 'no', 'snooze', 'open')),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (queue_id, action)
);

-- Lease for the scheduler tick so overlapping cron runs don't do duplicate work.
-- (A table lease rather than an advisory lock, because Supabase's transaction pooler
-- does not keep session-level locks.) Not user data: no RLS policies, no client access.
create table public.job_leases (
  name text primary key,
  holder text,
  expires_at timestamptz not null default '-infinity'
);
alter table public.job_leases enable row level security;
revoke all on public.job_leases from anon, authenticated;
insert into public.job_leases (name) values ('tick');

-- ---------------------------------------------------------------- row-level security
do $$
declare t text;
begin
  foreach t in array array['user_settings','items','item_versions','item_notification_rules','day_records',
    'day_items','response_events','corrections','push_subscriptions','notification_queue',
    'notification_attempts','notification_actions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select_own', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;
