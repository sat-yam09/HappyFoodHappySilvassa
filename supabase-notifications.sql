-- ADMIN NOTIFICATIONS VIEW
-- Run this in your Supabase SQL Editor to create a live feed of who liked and commented on what!

create or replace view public.admin_notifications as
select 
  l.id as id,
  l.created_at as created_at,
  'like' as type,
  p.title as post_title,
  p.id as post_id,
  pr.name as user_name
from public.likes l
join public.posts p on l.post_id = p.id
join public.profiles pr on l.user_id = pr.id

UNION ALL

select 
  c.id as id,
  c.created_at as created_at,
  'comment' as type,
  p.title as post_title,
  p.id as post_id,
  pr.name as user_name
from public.comments c
join public.posts p on c.post_id = p.id
join public.profiles pr on c.user_id = pr.id

order by created_at desc;

-- Ensure authenticated users can query the view
grant select on public.admin_notifications to authenticated;
