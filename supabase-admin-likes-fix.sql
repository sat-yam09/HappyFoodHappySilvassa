-- FIX FOR ADMIN LIKES CONTROL
-- Run this in your Supabase SQL Editor to allow admins to delete anyone's likes

-- Step 1: Drop the existing policy that forces users to only delete their own likes
drop policy if exists "Users can delete their own likes" on public.likes;

-- Step 2: Create a new policy that allows either the user OR an admin to delete the like
-- We check if the current user is an admin by seeing if their email matches your config email.
create policy "Users delete their own likes OR Admin can delete any" 
  on public.likes for delete 
  using ( 
    auth.uid() = user_id 
    or 
    auth.jwt() ->> 'email' = 'satyamchoudharyfreefree@gmail.com'
  );
