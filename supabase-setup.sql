-- BASE SUPABASE SETUP
-- Profiles + auth trigger + storage policies

create extension if not exists pgcrypto;

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

notify pgrst, 'reload schema';
