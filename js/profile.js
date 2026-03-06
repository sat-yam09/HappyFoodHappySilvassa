/* ============================================================
   PROFILE PAGE LOGIC — HappyFoodHappySilvassa
   Handles fetching user data, liked posts, and comments.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

const STRINGS = {
  noLikes: "No liked posts yet — explore the feed and heart what you love!",
  noComments: "You haven't commented yet — join the conversation!",
  deleteConfirm: "Are you sure you want to permanently delete this post?",
};

let currentUser = null;
let isAdmin = false;

/* === INIT CORE === */
const initProfile = async () => {
  // 1. Session check
  await checkSession(null, 'index.html');
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    currentUser = user;
    if (user.email?.toLowerCase() === CONFIG.adminEmail?.toLowerCase()) isAdmin = true;
  } else {
    window.location.href = 'index.html';
    return;
  }

  // 2. Render Header Meta
  renderHeader();

  // 3. Fetch Linked Data Parallelly with Retries
  await Promise.all([
    withRetry(fetchLikedPosts),
    withRetry(fetchMyComments),
    withRetry(renderAdminSetup)
  ]);
};

/* === HEADER RENDERING === */
const renderHeader = () => {
  const name = currentUser.user_metadata?.full_name || 'Foodie';
  const email = currentUser.email || 'No email';
  const avatarUrl = currentUser.user_metadata?.avatar_url;
  const createdStr = new Date(currentUser.created_at).toLocaleDateString('en-US', { year:'numeric', month: 'long' });

  // Initials (e.g. "Satyam" -> "S", "Satyam Sharma" -> "SS")
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  document.getElementById('userNameLabel').innerText = name;
  document.getElementById('userEmailLabel').innerText = email;
  document.getElementById('userMemberSince').innerText = `Member since ${createdStr}`;
  
  const avatarImg = document.getElementById('avatarImg');
  const userInitials = document.getElementById('userInitials');

  if (avatarUrl) {
    avatarImg.src = avatarUrl;
    avatarImg.style.display = 'block';
    userInitials.style.display = 'none';
  } else {
    avatarImg.style.display = 'none';
    userInitials.style.display = 'block';
    userInitials.innerText = initials;
  }
};


/* === LIKED POSTS RENDERING === */
const fetchLikedPosts = async () => {
  try {
    // Inner Join mapping: likes + posts
    const { data: likes, error } = await sb.from('likes')
      .select('created_at, posts(id, title, image_url)')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    const container = document.getElementById('likedScrollArea');

    if (!likes || likes.length === 0) {
      container.innerHTML = `<div class="empty-state">${STRINGS.noLikes}</div>`;
      return;
    }

    container.innerHTML = likes.map(like => {
      const p = like.posts;
      return `
        <a href="post.html?id=${p.id}" class="compact-card">
          <img src="${p.image_url || 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?w=300'}" class="compact-img" alt="Post thumbnail" loading="lazy">
          <div class="compact-title">${p.title}</div>
        </a>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load likes:', err);
    document.getElementById('likedScrollArea').innerHTML = `<div class="empty-state" style="color:red;">Error loading likes.</div>`;
  }
};


/* === MY COMMENTS RENDERING === */
const fetchMyComments = async () => {
  try {
    // Inner Join mapping: comments + post title
    const { data: comments, error } = await sb.from('comments')
      .select('content, created_at, posts(id, title)')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const container = document.getElementById('myCommentsList');

    if (!comments || comments.length === 0) {
      container.innerHTML = `<div class="empty-state">${STRINGS.noComments}</div>`;
      return;
    }

    container.innerHTML = comments.map(c => {
      const p = c.posts;
      const dateStr = new Date(c.created_at).toLocaleDateString('en-US', { day:'numeric', month:'short' });
      return `
        <div class="comment-card">
          <div class="comment-card-content">"${c.content}"</div>
          <div class="comment-card-meta">
            <span>on: <a href="post.html?id=${p.id}" class="comment-card-link">${p.title}</a></span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load comments:', err);
    document.getElementById('myCommentsList').innerHTML = `<div class="empty-state" style="color:red;">Error loading comments.</div>`;
  }
};


/* === ADMIN VISIBILITY CONTROLS === */
const renderAdminSetup = async () => {
  if (!isAdmin) return;

  const adminPanel = document.getElementById('adminSection');
  adminPanel.style.display = 'block';

  try {
    // 1. Fetch Stats Aggregates
    const { count: postCount } = await sb.from('posts').select('*', { count: 'exact', head: true });
    const { count: commentCount } = await sb.from('comments').select('*', { count: 'exact', head: true });
    
    document.getElementById('statGlobalPosts').innerText = postCount || 0;
    document.getElementById('statGlobalComments').innerText = commentCount || 0;

    // 2. Fetch all posts securely for quick deletion panel
    const { data: posts } = await sb.from('posts').select('id, title').order('created_at', { ascending: false }).limit(10);
    
    if (posts) {
      document.getElementById('adminPostList').innerHTML = posts.map(p => `
        <div class="admin-list-item" id="admin-post-${p.id}">
          <span class="admin-list-title">${p.title}</span>
          <a href="post.html?id=${p.id}" style="text-decoration:none; margin-right:10px;">👁</a>
          <button class="admin-del-btn" onclick="handleAdminDelete('${p.id}')">
            <svg width="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      `).join('');
    }

  } catch(err) {
    console.error('Admin Panel Error:', err);
  }
};

window.handleAdminDelete = async (postId) => {
  showConfirmModal({
    title: 'Delete Post?',
    text: 'This will permanently remove the post from everyone\'s feed.',
    onConfirm: async () => {
      try {
        await sb.from('posts').delete().eq('id', postId);
        const el = document.getElementById(`admin-post-${postId}`);
        if(el) el.remove();
        showToast('Post deleted permanently.', 'success');
      } catch(err) {
        showToast('Error deleting post.', 'error');
      }
    }
  });
};


/* === LOGOUT ACTION === */
window.handleLogout = async (e) => {
  if(e) e.preventDefault();
  // Provide UX confirmation wrapper
  const btn = document.getElementById('logoutBtn');
  btn.innerText = 'Logging out...';
  
  await sb.auth.signOut();
  window.location.href = 'index.html';
};


document.addEventListener('DOMContentLoaded', initProfile);
