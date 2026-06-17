-- Postvora Supabase schema: 03 updated_at triggers and RLS
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
