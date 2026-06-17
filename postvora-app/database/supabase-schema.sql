-- Postvora Supabase production schema
-- Run this in Supabase Dashboard > SQL Editor.
-- The app backend should use the Secret/service-role key. Do not expose that key in browser code.

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'google',
  provider_user_id text not null,
  email text not null,
  name text not null,
  picture_url text,
  plan text not null default 'free',
  subscription_status text not null default 'none',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (email)
);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  provider_id text not null,
  mode text not null default 'oauth',
  account_name text,
  connected_at timestamptz not null default now(),
  token_encrypted jsonb not null default '{}'::jsonb,
  provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id)
);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  text text not null,
  media_url text,
  campaign text not null default 'General',
  platforms text[] not null default '{}'::text[],
  status text not null default 'ready',
  schedule_date timestamptz,
  published_at timestamptz,
  insights jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_status_schedule_idx on posts(status, schedule_date);
create index if not exists posts_user_created_idx on posts(user_id, created_at desc);

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

-- Updated-at helper
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_users_set_updated_at on app_users;
create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

drop trigger if exists connections_set_updated_at on connections;
create trigger connections_set_updated_at
before update on connections
for each row execute function set_updated_at();

drop trigger if exists posts_set_updated_at on posts;
create trigger posts_set_updated_at
before update on posts
for each row execute function set_updated_at();

drop trigger if exists post_results_set_updated_at on post_results;
create trigger post_results_set_updated_at
before update on post_results
for each row execute function set_updated_at();

drop trigger if exists automations_set_updated_at on automations;
create trigger automations_set_updated_at
before update on automations
for each row execute function set_updated_at();

drop trigger if exists subscriptions_set_updated_at on subscriptions;
create trigger subscriptions_set_updated_at
before update on subscriptions
for each row execute function set_updated_at();

-- Keep tables locked from browser/public keys. The backend service key bypasses RLS.
alter table app_users enable row level security;
alter table sessions enable row level security;
alter table connections enable row level security;
alter table posts enable row level security;
alter table post_results enable row level security;
alter table media_assets enable row level security;
alter table automations enable row level security;
alter table events enable row level security;
alter table admin_settings enable row level security;
alter table subscriptions enable row level security;

-- Seed default automation templates for owner/global use. App can clone these per user later.
insert into automations (user_id, name, trigger_text, action_text, enabled)
select null, 'Best-time scheduler', 'When a post is saved as draft', 'Suggest the highest engagement window', true
where not exists (select 1 from automations where user_id is null and name = 'Best-time scheduler');

insert into automations (user_id, name, trigger_text, action_text, enabled)
select null, 'UTM link builder', 'When a URL is detected', 'Append campaign tracking parameters', false
where not exists (select 1 from automations where user_id is null and name = 'UTM link builder');
