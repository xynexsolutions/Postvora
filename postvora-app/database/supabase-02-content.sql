-- Postvora Supabase schema: 02 content, media, admin tables
create table if not exists post_results (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  provider_id text not null,
  platform text not null,
  ok boolean not null default false,
  status text not null default 'queued',
  mode text,
  message text,
  external_id text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists post_results_post_idx on post_results(post_id);
create index if not exists post_results_external_idx on post_results(provider_id, external_id);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  public_url text not null,
  storage_key text not null,
  provider text not null default 'cloudflare_r2',
  created_at timestamptz not null default now()
);

create index if not exists media_assets_user_idx on media_assets(user_id, created_at desc);

create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  name text not null,
  trigger_text text not null,
  action_text text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_created_idx on events(created_at desc);
create index if not exists events_user_created_idx on events(user_id, created_at desc);

create table if not exists admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  provider text not null default 'stripe',
  customer_id text,
  subscription_id text,
  plan text not null default 'free',
  status text not null default 'none',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_provider_subscription_idx
  on subscriptions(provider, subscription_id)
  where subscription_id is not null;
