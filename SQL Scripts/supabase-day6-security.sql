-- ==============================================================
-- DAY 6: Supabase Row Level Security (RLS) Complete Setup
-- Copy and paste this directly into your Supabase SQL Editor!
-- ==============================================================

-- ==========================
-- 1. PROFILES TABLE
-- ==========================
-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read any profile (for comment author names).
CREATE POLICY "Users can read any profile" ON profiles
FOR SELECT USING (true);

-- Policy: Users can only insert their own profile (id = auth.uid()).
CREATE POLICY "Users can only insert their own profile" ON profiles
FOR INSERT WITH CHECK (id = auth.uid());

-- Policy: Users can only update their own profile.
CREATE POLICY "Users can only update their own profile" ON profiles
FOR UPDATE USING (id = auth.uid());


-- ==========================
-- 2. POSTS TABLE
-- ==========================
-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone (including anonymous) can read posts.
CREATE POLICY "Everyone can read posts" ON posts
FOR SELECT USING (true);

-- Policy: Only admin email can INSERT new posts.
CREATE POLICY "Only admin email can INSERT new posts" ON posts
FOR INSERT WITH CHECK (auth.jwt()->>'email' = 'satyamchoudharyfreefree@gmail.com');

-- Policy: Only admin email can UPDATE posts.
CREATE POLICY "Only admin email can UPDATE posts" ON posts
FOR UPDATE USING (auth.jwt()->>'email' = 'satyamchoudharyfreefree@gmail.com');

-- Policy: Only admin email can DELETE posts.
CREATE POLICY "Only admin email can DELETE posts" ON posts
FOR DELETE USING (auth.jwt()->>'email' = 'satyamchoudharyfreefree@gmail.com');


-- ==========================
-- 3. COMMENTS TABLE
-- ==========================
-- Enable RLS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read comments.
CREATE POLICY "Everyone can read comments" ON comments
FOR SELECT USING (true);

-- Policy: Authenticated users can insert their own comments (user_id = auth.uid()).
CREATE POLICY "Authenticated users can insert their own comments" ON comments
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- Policy: Users can delete only their own comment or Admin can delete any comment.
CREATE POLICY "Users can delete their own comment or Admin can delete any comment" ON comments
FOR DELETE USING (
  user_id = auth.uid() 
  OR auth.jwt()->>'email' = 'satyamchoudharyfreefree@gmail.com'
);


-- ==========================
-- 4. LIKES TABLE
-- ==========================
-- Enable RLS
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read likes (for counts).
CREATE POLICY "Everyone can read likes" ON likes
FOR SELECT USING (true);

-- Policy: Authenticated users can insert a like (user_id = auth.uid()).
CREATE POLICY "Authenticated users can insert a like" ON likes
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- Policy: Users can delete only their own like (user_id = auth.uid()).
CREATE POLICY "Users can delete only their own like" ON likes
FOR DELETE USING (user_id = auth.uid());

-- Note: UNIQUE(post_id, user_id) is usually enforced on the table schema itself, preventing double-liking.


-- ==========================
-- 5. STORAGE BUCKET RULES (post-images)
-- ==========================
-- Note: Ensure you have manually created the 'post-images' bucket in Supabase Storage.

-- Policy: Read - public (everyone can view images via URL).
CREATE POLICY "public read for post-images" ON storage.objects
FOR SELECT USING (bucket_id = 'post-images');

-- Policy: Upload - authenticated users only.
CREATE POLICY "Auth users upload for post-images" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'post-images' 
  AND auth.role() = 'authenticated'
);

-- Policy: Delete - admin email only.
CREATE POLICY "Admin delete for post-images" ON storage.objects
FOR DELETE USING (
  bucket_id = 'post-images' 
  AND auth.jwt()->>'email' = 'satyamchoudharyfreefree@gmail.com'
);
