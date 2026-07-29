create table if not exists onboarded_targets (
  id uuid primary key,
  display_name text not null,
  target_type text not null,
  promptfoo_entity text not null,
  onboarding_object text not null,
  owner_name text,
  environment text not null default 'development',
  endpoint_url text,
  model_name text,
  auth_strategy text not null default 'none',
  system_prompt text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_test_plan (
  id uuid primary key,
  target_id uuid not null references onboarded_targets(id) on delete cascade,
  stage_order integer not null,
  stage_key text not null,
  stage_label text not null,
  status text not null default 'pending',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_id, stage_key)
);

create table if not exists target_stage_runs (
  id uuid primary key,
  target_id uuid not null references onboarded_targets(id) on delete cascade,
  stage_key text not null,
  status text not null default 'queued',
  run_options jsonb not null default '{}'::jsonb,
  config_snapshot jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists eval_cache (
  id uuid primary key,
  target_id uuid not null references onboarded_targets(id) on delete cascade,
  cache_key text not null,
  provider_label text,
  prompt text,
  output text not null,
  token_usage jsonb,
  latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_id, cache_key)
);

create table if not exists provider_secrets (
  id uuid primary key,
  target_id uuid not null references onboarded_targets(id) on delete cascade,
  provider_index integer,
  secret_kind text not null default 'api_key',
  algorithm text not null default 'aes-256-gcm',
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  masked_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_datasets (
  id uuid primary key,
  target_id uuid not null references onboarded_targets(id) on delete cascade,
  name text not null,
  version integer not null default 1,
  rows jsonb not null default '[]'::jsonb,
  source text not null default 'ui',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_id, name, version)
);

create table if not exists target_schedules (
  id uuid primary key,
  target_id uuid not null references onboarded_targets(id) on delete cascade,
  name text not null,
  stage_keys text[] not null default array['eval']::text[],
  interval_minutes integer not null default 1440,
  enabled boolean not null default true,
  run_options jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarded_targets_target_type_idx on onboarded_targets(target_type);
create index if not exists onboarded_targets_status_idx on onboarded_targets(status);
create index if not exists target_test_plan_target_id_idx on target_test_plan(target_id);
create index if not exists target_stage_runs_target_stage_idx on target_stage_runs(target_id, stage_key);
create index if not exists eval_cache_target_id_idx on eval_cache(target_id);
create index if not exists provider_secrets_target_id_idx on provider_secrets(target_id);
create index if not exists target_datasets_target_id_idx on target_datasets(target_id);
create index if not exists target_schedules_target_id_idx on target_schedules(target_id);
create index if not exists target_schedules_next_run_idx on target_schedules(enabled, next_run_at);
