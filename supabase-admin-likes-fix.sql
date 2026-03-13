-- FIX FOR ADMIN LIKES CONTROL
-- Run this in your Supabase SQL Editor to allow admins to delete anyone's likes

-- Step 1: Drop any older delete policies so this can be rerun safely
drop policy if exists "Users can delete their own likes" on public.likes;
drop policy if exists "Users delete their own likes OR Admin can delete any" on public.likes;
drop policy if exists "likes_delete_own_or_admin" on public.likes;

-- Step 2: Recreate the standard delete policy used by the app
create policy "likes_delete_own_or_admin"
  on public.likes for delete
  to authenticated
  using (
    auth.uid() = user_id 
    or
    auth.jwt() ->> 'email' = 'buildwithdevian@gmail.com'
  );

notify pgrst, 'reload schema';
