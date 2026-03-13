/* ============================================================
   PROFILE PAGE LOGIC - HappyFoodHappySilvassa
   Handles fetching user data, liked posts, and comments.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

const STRINGS = {
  noLikes: "No liked posts yet - explore the feed and heart what you love!",
  noComments: "You haven't commented yet - join the conversation!",
};

let currentUser = null;
let isAdmin = false;

const getFirstMedia = (mediaField) => {
  if (!mediaField) {
    return {
      url: 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80',
      type: 'image/jpeg'
    };
  }

  try {
    if (typeof mediaField === 'string' && mediaField.startsWith('[')) {
      const parsed = JSON.parse(mediaField);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (typeof parsed[0] === 'string') return { url: parsed[0], type: 'image/jpeg' };
        return parsed[0];
      }
    }
  } catch (_) {
    // Ignore malformed legacy values and fall back below.
  }

  if (typeof mediaField === 'string') return { url: mediaField, type: 'image/jpeg' };
  if (typeof mediaField === 'object' && mediaField.url) return mediaField;

  return {
    url: 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80',
    type: 'image/jpeg'
  };
};

const createEmptyState = (message, color = '') => {
  const state = document.createElement('div');
  state.className = 'empty-state';
  state.textContent = message;
  if (color) state.style.color = color;
  return state;
};

const renderHeader = () => {
  const name = currentUser.user_metadata?.full_name || 'Foodie';
  const email = currentUser.email || 'No email';
  const avatarUrl = currentUser.user_metadata?.avatar_url;
  const createdStr = new Date(currentUser.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  const initials = name.split(' ').map((part) => part[0]).join('').substring(0, 2).toUpperCase();

  document.getElementById('userNameLabel').innerText = name;
  document.getElementById('userEmailLabel').innerText = email;
  document.getElementById('userMemberSince').innerText = `Member since ${createdStr}`;

  const roleBadge = document.getElementById('userRoleBadge');
  if (roleBadge) {
    if (isAdmin) {
      roleBadge.innerText = 'Admin';
      roleBadge.className = 'role-badge role-admin';
    } else {
      roleBadge.innerText = 'Foodie Member';
      roleBadge.className = 'role-badge role-member';
    }
  }

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

const renderLikedPosts = (likes) => {
  const container = document.getElementById('likedScrollArea');

  if (!likes || likes.length === 0) {
    container.replaceChildren(createEmptyState(STRINGS.noLikes));
    return;
  }

  const fragment = document.createDocumentFragment();

  likes.forEach((like) => {
    const post = like.posts;
    if (!post?.id) return;

    const media = getFirstMedia(post.image_url);
    const isVideo = media.type && media.type.startsWith('video/');

    const link = document.createElement('a');
    link.href = `post.html?id=${encodeURIComponent(post.id)}`;
    link.className = 'compact-card';
    link.style.position = 'relative';

    if (isVideo) {
      const video = document.createElement('video');
      video.className = 'compact-img';
      video.src = media.url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.style.pointerEvents = 'none';

      const badge = document.createElement('span');
      badge.className = 'photo-count-badge';
      badge.style.position = 'absolute';
      badge.style.top = '8px';
      badge.style.left = '8px';
      badge.style.background = 'rgba(0,0,0,0.6)';
      badge.textContent = 'Video';

      link.append(video, badge);
    } else {
      const image = document.createElement('img');
      image.className = 'compact-img';
      image.src = media.url;
      image.alt = 'Post thumbnail';
      image.loading = 'lazy';
      link.appendChild(image);
    }

    const title = document.createElement('div');
    title.className = 'compact-title';
    title.textContent = post.title || 'Untitled Recipe';
    link.appendChild(title);

    fragment.appendChild(link);
  });

  container.replaceChildren(fragment);
};

const renderMyComments = (comments) => {
  const container = document.getElementById('myCommentsList');

  if (!comments || comments.length === 0) {
    container.replaceChildren(createEmptyState(STRINGS.noComments));
    return;
  }

  const fragment = document.createDocumentFragment();

  comments.forEach((comment) => {
    const post = comment.posts;
    if (!post?.id) return;

    const card = document.createElement('div');
    card.className = 'comment-card';

    const content = document.createElement('div');
    content.className = 'comment-card-content';
    content.textContent = `"${comment.content || ''}"`;

    const meta = document.createElement('div');
    meta.className = 'comment-card-meta';

    const onPost = document.createElement('span');
    onPost.append('on: ');

    const link = document.createElement('a');
    link.href = `post.html?id=${encodeURIComponent(post.id)}`;
    link.className = 'comment-card-link';
    link.textContent = post.title || 'Untitled Recipe';
    onPost.appendChild(link);

    const date = document.createElement('span');
    date.textContent = new Date(comment.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

    meta.append(onPost, date);
    card.append(content, meta);
    fragment.appendChild(card);
  });

  container.replaceChildren(fragment);
};

const renderAdminPostList = (posts) => {
  const list = document.getElementById('adminPostList');
  const fragment = document.createDocumentFragment();

  posts.forEach((post) => {
    const item = document.createElement('div');
    item.className = 'admin-list-item';
    item.id = `admin-post-${post.id}`;

    const title = document.createElement('span');
    title.className = 'admin-list-title';
    title.textContent = post.title || 'Untitled Recipe';

    const viewLink = document.createElement('a');
    viewLink.href = `post.html?id=${encodeURIComponent(post.id)}`;
    viewLink.style.textDecoration = 'none';
    viewLink.style.marginRight = '10px';
    viewLink.textContent = 'View';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'admin-del-btn';
    deleteBtn.type = 'button';
    deleteBtn.onclick = () => window.handleAdminDelete(post.id);
    deleteBtn.setAttribute('aria-label', `Delete ${post.title || 'post'}`);
    deleteBtn.innerHTML = '<svg width="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';

    item.append(title, viewLink, deleteBtn);
    fragment.appendChild(item);
  });

  list.replaceChildren(fragment);
};

const fetchLikedPosts = async () => {
  try {
    const { data: likes, error } = await sb.from('likes')
      .select('created_at, posts(id, title, image_url)')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    renderLikedPosts(likes);
  } catch (err) {
    console.error('Failed to load likes:', err);
    document.getElementById('likedScrollArea').replaceChildren(createEmptyState('Error loading likes.', 'red'));
  }
};

const fetchMyComments = async () => {
  try {
    const { data: comments, error } = await sb.from('comments')
      .select('content, created_at, posts(id, title)')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    renderMyComments(comments);
  } catch (err) {
    console.error('Failed to load comments:', err);
    document.getElementById('myCommentsList').replaceChildren(createEmptyState('Error loading comments.', 'red'));
  }
};

const renderAdminSetup = async () => {
  if (!isAdmin) return;

  const adminPanel = document.getElementById('adminSection');
  adminPanel.style.display = 'block';

  try {
    const { count: postCount, error: postsCountError } = await sb.from('posts').select('*', { count: 'exact', head: true });
    if (postsCountError) throw postsCountError;

    const { count: commentCount, error: commentsCountError } = await sb.from('comments').select('*', { count: 'exact', head: true });
    if (commentsCountError) throw commentsCountError;

    document.getElementById('statGlobalPosts').innerText = postCount || 0;
    document.getElementById('statGlobalComments').innerText = commentCount || 0;

    const { data: posts, error: postsError } = await sb.from('posts')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(10);

    if (postsError) throw postsError;
    renderAdminPostList(posts || []);
  } catch (err) {
    console.error('Admin Panel Error:', err);
  }
};

const initProfile = async () => {
  await checkSession(null, 'index.html');

  try {
    await sb.auth.refreshSession();
  } catch (err) {
    console.warn('Session refresh failed, using existing session.', err);
  }

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  currentUser = user;
  isAdmin = window.revealAdminUI(user);

  renderHeader();

  await Promise.all([
    withRetry(fetchLikedPosts),
    withRetry(fetchMyComments),
    withRetry(renderAdminSetup)
  ]);
};

window.handleAdminDelete = async (postId) => {
  showConfirmModal({
    title: 'Delete Post?',
    text: 'This will permanently remove the post from everyone\'s feed.',
    onConfirm: async () => {
      try {
        const { data, error } = await sb.from('posts').delete().eq('id', postId).select('id');
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('Post could not be deleted.');
        }

        const el = document.getElementById(`admin-post-${postId}`);
        if (el) el.remove();
        showToast('Post deleted permanently.', 'success');
      } catch (err) {
        console.error('Admin delete failed:', err);
        showToast('Error deleting post.', 'error');
      }
    }
  });
};

window.handleLogout = async (e) => {
  if (e) e.preventDefault();
  const btn = document.getElementById('logoutBtn');
  btn.innerText = 'Logging out...';

  await sb.auth.signOut();
  sessionStorage.removeItem('__HFHS_ENV');
  sessionStorage.removeItem('__HFHS_ENV_V');
  window.location.href = 'index.html';
};

document.addEventListener('DOMContentLoaded', initProfile);
