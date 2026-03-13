-- ADMIN NOTIFICATIONS VIEW
-- Only the configured admin email should receive rows from this view.

create or replace view public.admin_notifications as
select *
from (
  select
    l.id as id,
    l.created_at as created_at,
    'like'::text as type,
    p.title as post_title,
    p.id as post_id,
    coalesce(pr.name, 'Someone') as user_name
  from public.likes l
  join public.posts p on p.id = l.post_id
  left join public.profiles pr on pr.id = l.user_id

  union all

  select
    c.id as id,
    c.created_at as created_at,
    'comment'::text as type,
    p.title as post_title,
    p.id as post_id,
    coalesce(pr.name, c.user_name, 'Someone') as user_name
  from public.comments c
  join public.posts p on p.id = c.post_id
  left join public.profiles pr on pr.id = c.user_id
) notifications
where auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com'
order by created_at desc;

revoke all on public.admin_notifications from public;
revoke all on public.admin_notifications from anon;
revoke all on public.admin_notifications from authenticated;
grant select on public.admin_notifications to authenticated;

notify pgrst, 'reload schema';
