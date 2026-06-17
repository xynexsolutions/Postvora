-- Postvora Supabase schema: 01 core tables
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
