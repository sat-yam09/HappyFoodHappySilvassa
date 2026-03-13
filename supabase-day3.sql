-- POSTS, LIKES, COMMENTS, COUNTERS, AND REALTIME

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

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
  add column if not exists image_url text,
  add column if not exists likes_count integer not null default 0,
  add column if not exists comments_count integer not null default 0,
  add column if not exists tags text[] not null default '{}',
  add column if not exists publish_at timestamptz;

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique(post_id, user_id)
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
