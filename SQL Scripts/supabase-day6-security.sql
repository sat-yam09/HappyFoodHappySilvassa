-- SECURITY REPAIR SCRIPT
-- Reapplies the intended RLS and storage policies to an existing project.

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;

drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Users can insert their own profile." on public.profiles;
drop policy if exists "Users can update own profile." on public.profiles;
drop policy if exists "Users can read any profile" on public.profiles;
drop policy if exists "Users can only insert their own profile" on public.profiles;
drop policy if exists "Users can only update their own profile" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

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

notify pgrst, 'reload schema';
