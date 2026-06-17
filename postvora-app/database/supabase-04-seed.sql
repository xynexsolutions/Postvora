-- Postvora Supabase schema: 04 seed default automation templates
insert into automations (user_id, name, trigger_text, action_text, enabled)
select null, 'Best-time scheduler', 'When a post is saved as draft', 'Suggest the highest engagement window', true
where not exists (
  select 1 from automations
  where user_id is null and name = 'Best-time scheduler'
);

insert into automations (user_id, name, trigger_text, action_text, enabled)
select null, 'UTM link builder', 'When a URL is detected', 'Append campaign tracking parameters', false
where not exists (
  select 1 from automations
  where user_id is null and name = 'UTM link builder'
);
