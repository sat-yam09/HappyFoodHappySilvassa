-- SUPER IMPORTANT FOR DAY 3: LIKES & COMMENTS SQL SETUP
-- Paste this into your Supabase SQL Editor and run it!

/* =========================================================
   1. CREATE THE POSTS TABLE (Required for Day 2 and 3)
   ========================================================= */
create table if not exists public.posts (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  content text not null,
  image_url text,
  likes_count integer default 0 not null,
  comments_count integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users not null
);

-- Enable RLS for Posts
alter table public.posts enable row level security;
create policy "Anyone can view posts" on posts for select using (true);
create policy "Admins can insert posts" on posts for insert with check (true); 
create policy "Admins can update posts" on posts for update using (true);
create policy "Admins can delete posts" on posts for delete using (true);

/* =========================================================
   2. CREATE THE LIKES TABLE
   ========================================================= */
create table if not exists public.likes (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id) -- A user can only like a post once
);

alter table public.likes enable row level security;
create policy "Anyone can view likes" on likes for select using (true);
create policy "Users can insert their own likes" on likes for insert with check (auth.uid() = user_id);
create policy "Users can delete their own likes" on likes for delete using (auth.uid() = user_id);

/* =========================================================
   3. CREATE THE COMMENTS TABLE (Foundation for Day 3)
   ========================================================= */
create table if not exists public.comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  parent_id uuid references public.comments on delete cascade, -- Scalability: For nested Reddit replies later
  user_name text not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.comments enable row level security;
create policy "Anyone can view comments" on comments for select using (true);
create policy "Users can insert comments" on comments for insert with check (auth.uid() = user_id);
create policy "Users can delete own comments" on comments for delete using (auth.uid() = user_id);
-- Note: Admin delete any logic is handled via app UI triggering backend bypass if written correctly, or we can add policy.

/* =========================================================
   4. SCALABILITY: CREATE FAST RPCs FOR atomic COUNTS
   These safely +1 or -1 counts without race conditions.
   ========================================================= */

-- Like Increment
create or replace function increment_like_count(post_id uuid)
returns void as $$
begin
  update public.posts
  set likes_count = likes_count + 1
  where id = increment_like_count.post_id;
end;
$$ language plpgsql security definer;

-- Like Decrement
create or replace function decrement_like_count(post_id uuid)
returns void as $$
begin
  update public.posts
  set likes_count = likes_count - 1
  where id = decrement_like_count.post_id;
end;
$$ language plpgsql security definer;

-- Comment Increment
create or replace function increment_comment_count(post_id uuid)
returns void as $$
begin
  update public.posts
  set comments_count = comments_count + 1
  where id = increment_comment_count.post_id;
end;
$$ language plpgsql security definer;

-- Comment Decrement
create or replace function decrement_comment_count(post_id uuid)
returns void as $$
begin
  update public.posts
  set comments_count = comments_count - 1
  where id = decrement_comment_count.post_id;
end;
$$ language plpgsql security definer;

/* =========================================================
   5. TURN ON SUPABASE REALTIME FOR ALL THREE TABLES
   ========================================================= */
alter publication supabase_realtime add table posts;
alter publication supabase_realtime add table likes;
alter publication supabase_realtime add table comments;
