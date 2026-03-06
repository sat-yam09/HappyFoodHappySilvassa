/* ============================================================
   FEED DATA LAYER & LOGIC — HappyFoodHappySilvassa
   Handles fetching, realtime subscriptions, filters, and rendering.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

/* === STRINGS === 
   Scalable pattern for future internationalizations (i18n) */
const STRINGS = {
  feedTitle: "Feed",
  searchPlaceholder: "Search delicious recipes...",
  emptyTitle: "Nothing found",
  emptyDesc: "Try matching a different keyword.",
  errorLoad: "Error loading posts.",
  deleteConfirm: "Are you sure you want to delete this post?",
  deleteSuccess: "Post deleted successfully",
};

/* === GLOBAL STATE === */
let currentUser = null;
let isAdmin = false;

// Filter State Manager (Scalable basis for pagination/infinite scroll)
window.FilterState = {
  activeFilter: 'latest', // latest | oldest | most_liked | most_commented
  searchTerm: '',
  page: 1,
  perPage: 12
};

/* === DATA LAYER: PostService === */
const PostService = {
  subscription: null,

  async fetchAll(filterState) {
    let query = sb.from('posts').select('*');

    // 1. Search Filter
    if (filterState.searchTerm) {
      query = query.ilike('title', `%${filterState.searchTerm}%`);
    }

    // 2. Ordering Filter
    switch (filterState.activeFilter) {
      case 'latest':
        query = query.order('created_at', { ascending: false });
        break;
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'most_liked':
        query = query.order('likes_count', { ascending: false });
        break;
      case 'most_commented':
        query = query.order('comments_count', { ascending: false });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    // 3. Pagination Foundation
    const from = (filterState.page - 1) * filterState.perPage;
    const to = from + filterState.perPage - 1;
    query = query.range(from, to);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async deletePost(id) {
    const { error } = await sb.from('posts').delete().eq('id', id);
    if (error) throw error;
  },

  // Setup Realtime: New posts + Like updates
  subscribeToUpdates(onNewPost, onUpdatePost) {
    this.subscription = sb.channel('public:posts')
      // Listen for INSERTS (New posts appearing live)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
        onNewPost(payload.new);
      })
      // Listen for UPDATES (Like/Comment count changing live)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, payload => {
        onUpdatePost(payload.new);
      })
      // Listen for DELETES (Another admin drops a post Live)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, payload => {
        removeCardFromDOM(payload.old.id);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          const dot = document.getElementById('rt-status-dot');
          if (dot) dot.remove();
        }
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          showRealtimeDisconnectDot();
        }
      });
  },

  unsubscribe() {
    if (this.subscription) sb.removeChannel(this.subscription);
  }
};



/* === UI RENDER LOGIC === */
const feedGrid = document.getElementById('feedGrid');

const renderCard = (post, isNew = false) => {
  // Truncate excerpt
  let excerpt = post.content || '';
  if (excerpt.length > 120) excerpt = excerpt.substring(0, 120) + '...';

  // Format Date gracefully
  const dateStr = new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Delete button if admin
  const deleteBtnHTML = isAdmin 
    ? `<button class="delete-btn" onclick="event.preventDefault(); handleDelete('${post.id}')" title="Delete Post">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
       </button>` 
    : '';

  // The Card (a clickable link block)
  return `
    <a href="post.html?id=${post.id}" class="post-card ${isNew ? 'new-post' : ''}" id="post-${post.id}">
      ${deleteBtnHTML}
      <img src="${post.image_url || 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'}" alt="Food" class="post-image" loading="lazy">
      
      <div class="post-content">
        <h3 class="post-title">${post.title || 'Untitled Recipe'}</h3>
        <p class="post-excerpt">${excerpt}</p>
        
        <div class="post-footer">
          <div class="post-stats">
            <span class="stat-item" title="Likes">
              ❤️ <span data-post-id="${post.id}" data-stat="likes">${post.likes_count || 0}</span>
            </span>
            <span class="stat-item" title="Comments">
              💬 <span>${post.comments_count || 0}</span>
            </span>
          </div>
          <span class="post-date">${dateStr}</span>
        </div>
      </div>
    </a>
  `;
};

const renderSkeletons = () => {
  feedGrid.innerHTML = Array(3).fill(`
    <div class="post-card skeleton skel-card">
      <div class="skel-img skeleton"></div>
      <div class="skel-title skeleton"></div>
      <div class="skel-text skeleton"></div>
      <div class="skel-text skeleton" style="width: 70%;"></div>
    </div>
  `).join('');
};

const renderEmptyState = () => {
  feedGrid.innerHTML = `
    <div class="empty-state">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10V3L4 14h7v7l9-11h-7z"></path></svg>
      <h3>${STRINGS.emptyTitle}</h3>
      <p>${STRINGS.emptyDesc}</p>
    </div>
  `;
};

// Main render pipeline based on FilterState
const renderFeed = async () => {
  if (FilterState.page === 1) renderSkeletons();

  try {
    const posts = await withRetry(() => PostService.fetchAll(FilterState));
    
    if (posts.length === 0) {
      renderEmptyState();
      return;
    }

    const html = posts.map(p => renderCard(p)).join('');
    
    if (FilterState.page === 1) {
      feedGrid.innerHTML = html;
    } else {
      feedGrid.insertAdjacentHTML('beforeend', html);
    }
    
  } catch (err) {
    showToast(STRINGS.errorLoad, 'error');
    console.error(err);
  }
};

/* === EVENT HANDLERS === */

// Realtime Injection Handlers
const handleNewPostArrival = (post) => {
  // Only inject if matching current search/filter vaguely, or always drop at top 
  // if on 'latest' to keep it feeling magical!
  if (FilterState.activeFilter === 'latest' && FilterState.page === 1) {
    feedGrid.insertAdjacentHTML('afterbegin', renderCard(post, true));
  }
};

const handleUpdatePostArrival = (post) => {
  const likeSpan = document.querySelector(`span[data-post-id="${post.id}"][data-stat="likes"]`);
  if (likeSpan) likeSpan.innerText = post.likes_count || 0;
};

// Admin DOM deletion 
const removeCardFromDOM = (id) => {
  const el = document.getElementById(`post-${id}`);
  if (el) {
    el.style.opacity = '0';
    el.style.height = '0';
    el.style.padding = '0';
    el.style.margin = '0';
    setTimeout(() => el.remove(), 300);
  }
};

// Delete Handler (Admin Triggered)
window.handleDelete = async (id) => {
  showConfirmModal({
    title: 'Delete Recipe?',
    text: 'This action is permanent and cannot be undone.',
    onConfirm: async () => {
      try {
        await PostService.deletePost(id);
        removeCardFromDOM(id);
        showToast(STRINGS.deleteSuccess, 'success');
      } catch (err) {
        showToast('Error deleting post.', 'error');
      }
    }
  });
};

// Filter Interactions
const handleFilterChange = (el, type) => {
  // Update UI Pills
  document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
  el.classList.add('active');

  // Update State & Re-render
  FilterState.activeFilter = type;
  FilterState.page = 1; // reset pagination
  renderFeed();
};

// Search Debouncer
let searchTimeout;
const handleSearch = (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    FilterState.searchTerm = e.target.value.trim();
    FilterState.page = 1;
    renderFeed();
  }, 400); // 400ms debounce
};

// Global Logout Handler
window.handleLogout = async (e) => {
  if(e) e.preventDefault();
  await sb.auth.signOut();
  window.location.href = 'index.html';
};


/* === PAGE INITIALIZATION === */
const initFeed = async () => {
  // 1. Session Guard (Redirect to index if NOT logged in)
  await checkSession(null, 'index.html');

  // 2. Fetch User Object
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    currentUser = user;
    if (currentUser.email === CONFIG.adminEmail) {
      isAdmin = true;
      // Expose admin buttons via CSS class toggling
      document.querySelectorAll('.is-admin').forEach(el => el.style.display = 'flex');
    }
  }

  // 3. Attach Listeners
  document.getElementById('searchInput').addEventListener('input', handleSearch);

  // 4. Initial Fetch
  await renderFeed();

  // 5. Setup Live Subscription
  PostService.subscribeToUpdates(handleNewPostArrival, handleUpdatePostArrival);
};

document.addEventListener('DOMContentLoaded', initFeed);
