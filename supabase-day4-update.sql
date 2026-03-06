-- DAY 4: ADD METADATA COLUMNS TO POSTS TABLE
-- Run this in your Supabase SQL Editor to support Tags and Scheduling

-- 1. Add 'tags' column (Array of text)
alter table public.posts 
add column if not exists tags text[] default '{}';

-- 2. Add 'publish_at' column (For future scheduling)
alter table public.posts 
add column if not exists publish_at timestamp with time zone;

-- Optional: Refresh the schema cache manually if the error persists
NOTIFY pgrst, 'reload schema';
