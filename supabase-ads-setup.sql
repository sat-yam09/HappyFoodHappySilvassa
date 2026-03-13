-- ADS SYSTEM SCHEMA
-- Safe to rerun on an existing project.

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
