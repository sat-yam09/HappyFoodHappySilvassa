# HappyFoodHappySilvassa

This README contains the clean Supabase SQL setup for the current app.

Use this README instead of the older SQL notes in the repo. The old SQL files conflict with each other in a few places.

Important:
- Run the SQL blocks in order.
- The blocks below are written to be safe to rerun.
- The admin email in these SQL blocks is `buildwithdevian@gmail.com` because that matches the current app code in `js/config.js`.
- If you want a different admin email, replace every `buildwithdevian@gmail.com` below and also update `js/config.js` or your deployed `ADMIN_EMAIL` env var to the same value.
- These scripts use the `images` storage bucket because that matches the current frontend code.
- If you load config from `/api/config`, keep `STORAGE_BUCKET=images` unless you intentionally change both the SQL and frontend config together.

## SQL 1 - Base Setup

Paste this first in the Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;

drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Users can insert their own profile." on public.profiles;
drop policy if exists "Users can update own profile." on public.profiles;
drop policy if exists "Users can read any profile" on public.profiles;
drop policy if exists "Users can only insert their own profile" on public.profiles;
drop policy if exists "Users can only update their own profile" on public.profiles;

create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email
  )
  on conflict (id) do update
  set
    name = excluded.name,
    email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Authenticated users can upload images" on storage.objects;
drop policy if exists "public read for post-images" on storage.objects;
drop policy if exists "Auth users upload for post-images" on storage.objects;
drop policy if exists "Admin delete for post-images" on storage.objects;
drop policy if exists "images_public_read" on storage.objects;
drop policy if exists "images_admin_upload" on storage.objects;
drop policy if exists "images_admin_delete" on storage.objects;

create policy "images_public_read"
  on storage.objects
  for select
  using (bucket_id = 'images');

create policy "images_admin_upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'images'
    and auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com'
  );

create policy "images_admin_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'images'
    and auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com'
  );
```

## SQL 2 - Posts, Likes, Comments, Count Triggers, Realtime

Paste this second:

```sql
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  image_url text,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  tags text[] not null default '{}',
  publish_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  user_id uuid not null references auth.users(id) on delete cascade
);

alter table public.posts
  add column if not exists tags text[] not null default '{}',
  add column if not exists publish_at timestamptz;

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  user_name text not null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists likes_post_user_unique_idx
  on public.likes (post_id, user_id);

create index if not exists posts_created_at_idx
  on public.posts (created_at desc);

create index if not exists posts_likes_count_idx
  on public.posts (likes_count desc, created_at desc);

create index if not exists posts_comments_count_idx
  on public.posts (comments_count desc, created_at desc);

create index if not exists posts_title_trgm_idx
  on public.posts using gin (title gin_trgm_ops);

create index if not exists comments_post_created_idx
  on public.comments (post_id, created_at asc);

create index if not exists comments_user_created_idx
  on public.comments (user_id, created_at desc);

create index if not exists likes_user_created_idx
  on public.likes (user_id, created_at desc);

alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

drop policy if exists "Anyone can view posts" on public.posts;
drop policy if exists "Admins can insert posts" on public.posts;
drop policy if exists "Admins can update posts" on public.posts;
drop policy if exists "Admins can delete posts" on public.posts;
drop policy if exists "Everyone can read posts" on public.posts;
drop policy if exists "Only admin email can INSERT new posts" on public.posts;
drop policy if exists "Only admin email can UPDATE posts" on public.posts;
drop policy if exists "Only admin email can DELETE posts" on public.posts;
drop policy if exists "posts_select_authenticated" on public.posts;
drop policy if exists "posts_admin_insert" on public.posts;
drop policy if exists "posts_admin_update" on public.posts;
drop policy if exists "posts_admin_delete" on public.posts;

create policy "posts_select_authenticated"
  on public.posts
  for select
  to authenticated
  using (true);

create policy "posts_admin_insert"
  on public.posts
  for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

create policy "posts_admin_update"
  on public.posts
  for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com')
  with check (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

create policy "posts_admin_delete"
  on public.posts
  for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

drop policy if exists "Anyone can view likes" on public.likes;
drop policy if exists "Users can insert their own likes" on public.likes;
drop policy if exists "Users can delete their own likes" on public.likes;
drop policy if exists "Users delete their own likes OR Admin can delete any" on public.likes;
drop policy if exists "Everyone can read likes" on public.likes;
drop policy if exists "Authenticated users can insert a like" on public.likes;
drop policy if exists "Users can delete only their own like" on public.likes;
drop policy if exists "likes_select_authenticated" on public.likes;
drop policy if exists "likes_insert_own" on public.likes;
drop policy if exists "likes_delete_own_or_admin" on public.likes;

create policy "likes_select_authenticated"
  on public.likes
  for select
  to authenticated
  using (true);

create policy "likes_insert_own"
  on public.likes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "likes_delete_own_or_admin"
  on public.likes
  for delete
  to authenticated
  using (
    auth.uid() = user_id
    or auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com'
  );

drop policy if exists "Anyone can view comments" on public.comments;
drop policy if exists "Users can insert comments" on public.comments;
drop policy if exists "Users can delete own comments" on public.comments;
drop policy if exists "Everyone can read comments" on public.comments;
drop policy if exists "Authenticated users can insert their own comments" on public.comments;
drop policy if exists "Users can delete their own comment or Admin can delete any comment" on public.comments;
drop policy if exists "comments_select_authenticated" on public.comments;
drop policy if exists "comments_insert_own" on public.comments;
drop policy if exists "comments_delete_own_or_admin" on public.comments;

create policy "comments_select_authenticated"
  on public.comments
  for select
  to authenticated
  using (true);

create policy "comments_insert_own"
  on public.comments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "comments_delete_own_or_admin"
  on public.comments
  for delete
  to authenticated
  using (
    auth.uid() = user_id
    or auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com'
  );

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'increment_like_count'
  ) then
    revoke execute on function public.increment_like_count(uuid) from public, anon, authenticated;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'decrement_like_count'
  ) then
    revoke execute on function public.decrement_like_count(uuid) from public, anon, authenticated;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'increment_comment_count'
  ) then
    revoke execute on function public.increment_comment_count(uuid) from public, anon, authenticated;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'decrement_comment_count'
  ) then
    revoke execute on function public.decrement_comment_count(uuid) from public, anon, authenticated;
  end if;
end
$$;

drop function if exists public.increment_like_count(uuid);
drop function if exists public.decrement_like_count(uuid);
drop function if exists public.increment_comment_count(uuid);
drop function if exists public.decrement_comment_count(uuid);

create or replace function public.sync_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
    set likes_count = likes_count + 1
    where id = new.post_id;
    return new;
  end if;

  update public.posts
  set likes_count = greatest(likes_count - 1, 0)
  where id = old.post_id;
  return old;
end;
$$;

create or replace function public.sync_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
    set comments_count = comments_count + 1
    where id = new.post_id;
    return new;
  end if;

  update public.posts
  set comments_count = greatest(comments_count - 1, 0)
  where id = old.post_id;
  return old;
end;
$$;

drop trigger if exists likes_count_sync on public.likes;
create trigger likes_count_sync
  after insert or delete on public.likes
  for each row
  execute procedure public.sync_post_like_count();

drop trigger if exists comments_count_sync on public.comments;
create trigger comments_count_sync
  after insert or delete on public.comments
  for each row
  execute procedure public.sync_post_comment_count();

update public.posts p
set
  likes_count = coalesce((
    select count(*)::integer
    from public.likes l
    where l.post_id = p.id
  ), 0),
  comments_count = coalesce((
    select count(*)::integer
    from public.comments c
    where c.post_id = p.id
  ), 0);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'likes'
  ) then
    alter publication supabase_realtime add table public.likes;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end
$$;

notify pgrst, 'reload schema';
```

## SQL 3 - Ads Setup

Paste this third:

```sql
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  media_url text not null,
  media_type text not null default 'image',
  link_url text,
  placement text not null default 'feed',
  business_name text,
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  click_count integer not null default 0,
  impression_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists ads_active_lookup_idx
  on public.ads (is_active, placement, created_at desc);

alter table public.ads enable row level security;

drop policy if exists "Anyone can read active ads" on public.ads;
drop policy if exists "Authenticated admin can insert ads" on public.ads;
drop policy if exists "Authenticated admin can update ads" on public.ads;
drop policy if exists "Authenticated admin can delete ads" on public.ads;
drop policy if exists "Authenticated admin can read all ads" on public.ads;
drop policy if exists "ads_select_active" on public.ads;
drop policy if exists "ads_admin_select_all" on public.ads;
drop policy if exists "ads_admin_insert" on public.ads;
drop policy if exists "ads_admin_update" on public.ads;
drop policy if exists "ads_admin_delete" on public.ads;

create policy "ads_select_active"
  on public.ads
  for select
  to authenticated
  using (
    is_active = true
    and (ends_at is null or ends_at > now())
  );

create policy "ads_admin_select_all"
  on public.ads
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

create policy "ads_admin_insert"
  on public.ads
  for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

create policy "ads_admin_update"
  on public.ads
  for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com')
  with check (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

create policy "ads_admin_delete"
  on public.ads
  for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com');

create or replace function public.increment_ad_click(ad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ads
  set click_count = click_count + 1
  where id = increment_ad_click.ad_id;
end;
$$;

create or replace function public.increment_ad_impression(ad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ads
  set impression_count = impression_count + 1
  where id = increment_ad_impression.ad_id;
end;
$$;

grant execute on function public.increment_ad_click(uuid) to authenticated;
grant execute on function public.increment_ad_impression(uuid) to authenticated;

notify pgrst, 'reload schema';
```

## SQL 4 - Admin Notifications View

Paste this fourth:

```sql
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
```

## After Running The SQL

1. Make sure `js/config.js` and your deployed `ADMIN_EMAIL` env variable use the same admin email as the SQL above.
2. If you use `/api/config`, also set `STORAGE_BUCKET=images` unless you intentionally change the bucket name everywhere.
3. Do not run the older conflicting SQL files after this README setup.
4. If you are on a fresh project, create your admin account using the same email you used above.
5. Then test this order:
   - signup/login
   - create post
   - feed load
   - like/comment
   - profile
   - notifications
   - ads manager

## Current Known App Notes

- Post like and comment counters are now intended to be maintained by database triggers, not by client RPC calls.
- The current README SQL is designed to match the existing frontend code and the repaired SQL files in this repo.
