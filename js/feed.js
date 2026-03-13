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

let isFetching = false;
let hasMore = true;
let mobileAdShown = false;
let sortRefreshTimeout = null;
const realtimePostBuffer = new Map();
const LAST_MOBILE_AD_KEY = 'hfhs_last_mobile_ad_id';
const scrollSentinel = document.createElement('div');
scrollSentinel.id = 'scrollSentinel';
scrollSentinel.style.height = '10px';
scrollSentinel.style.width = '100%';

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getPostTags = (post) => {
  if (Array.isArray(post?.tags)) return post.tags;
  if (typeof post?.tags === 'string') {
    return post.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
};

const matchesSearchTerm = (post, searchTerm) => {
  if (!searchTerm) return true;
  const haystack = [
    post?.title || '',
    post?.content || '',
    getPostTags(post).join(' ')
  ].join(' ').toLowerCase();
  return haystack.includes(searchTerm.toLowerCase());
};

const mergeRealtimePosts = (posts, filterState) => {
  if (filterState.page !== 1 || filterState.activeFilter !== 'latest') {
    return posts;
  }

  const merged = [...posts];

  realtimePostBuffer.forEach((post, id) => {
    if (!matchesSearchTerm(post, filterState.searchTerm)) return;
    if (!merged.some((item) => item.id === id)) {
      merged.unshift(post);
    }
  });

  merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return merged;
};

const hydrateRecentPostFromSession = () => {
  try {
    const raw = sessionStorage.getItem('hfhs_recent_post');
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const recentPost = parsed?.post || parsed;
    const expiresAt = parsed?.expiresAt;

    if (expiresAt && expiresAt < Date.now()) {
      sessionStorage.removeItem('hfhs_recent_post');
      return;
    }

    if (recentPost?.id) {
      realtimePostBuffer.set(recentPost.id, recentPost);
    }
  } catch (_) {
    sessionStorage.removeItem('hfhs_recent_post');
  }
};

/* === DATA LAYER: PostService === */
const PostService = {
  subscription: null,

  buildBaseQuery(filterState) {
    let query = sb.from('posts').select('*');

    switch (filterState.activeFilter) {
      case 'latest':
        query = query.order('created_at', { ascending: false });
        break;
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'most_liked':
        query = query.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'most_commented':
        query = query.order('comments_count', { ascending: false }).order('created_at', { ascending: false });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    return query;
  },

  async fetchAll(filterState) {
    if (!filterState.searchTerm) {
      const from = (filterState.page - 1) * filterState.perPage;
      const to = from + filterState.perPage - 1;
      const { data, error } = await this.buildBaseQuery(filterState).range(from, to);
      if (error) throw error;
      return data;
    }

    const batchSize = Math.max(filterState.perPage * 4, 48);
    const requiredMatches = filterState.page * filterState.perPage;
    const matchedPosts = [];
    let offset = 0;
    let exhausted = false;

    while (matchedPosts.length < requiredMatches && !exhausted) {
      const { data, error } = await this.buildBaseQuery(filterState).range(offset, offset + batchSize - 1);
      if (error) throw error;

      if (!data || data.length === 0) {
        exhausted = true;
        break;
      }

      matchedPosts.push(...data.filter((post) => matchesSearchTerm(post, filterState.searchTerm)));

      if (data.length < batchSize) {
        exhausted = true;
      } else {
        offset += batchSize;
      }
    }

    const from = (filterState.page - 1) * filterState.perPage;
    const to = from + filterState.perPage;
    return matchedPosts.slice(from, to);
  },

  async deletePost(id) {
    const { data, error } = await sb.from('posts').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Post could not be deleted.');
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


/* === AD SERVICE === */
const AdService = {
  cachedAds: [],

  async fetchActive() {
    const { data, error } = await sb.from('ads')
      .select('*')
      .eq('is_active', true)
      .or('ends_at.is.null,ends_at.gt.' + new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) { console.error('Ad fetch error:', error); return []; }
    this.cachedAds = data || [];
    return this.cachedAds;
  },

  getFeedAds() {
    return this.cachedAds.filter(a => a.placement === 'feed' || a.placement === 'both');
  },

  getSidebarAds() {
    return this.cachedAds.filter(a => a.placement === 'sidebar' || a.placement === 'both');
  },

  async trackClick(adId) {
    try { await sb.rpc('increment_ad_click', { ad_id: adId }); } catch (err) { }
  },

  async trackImpression(adId) {
    try { await sb.rpc('increment_ad_impression', { ad_id: adId }); } catch (err) { }
  }
};



/* === UI RENDER LOGIC === */
const feedGrid = document.getElementById('feedGrid');

// Helper: extract first media object
const getFirstMedia = (mediaField) => {
  if (!mediaField) return { url: 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', type: 'image/jpeg' };

  try {
    if (typeof mediaField === 'string' && (mediaField.startsWith('[') || mediaField.startsWith('{'))) {
      const parsed = JSON.parse(mediaField);
      // Array of media objects
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (typeof parsed[0] === 'string') return { url: parsed[0], type: 'image/jpeg' };
        return parsed[0];
      }
      // Single media object stored as JSON string
      if (parsed && parsed.url) return parsed;
    }
  } catch (e) { /* fallback */ }

  if (typeof mediaField === 'string') return { url: mediaField, type: 'image/jpeg' };
  if (typeof mediaField === 'object' && mediaField.url) return mediaField;

  return { url: 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', type: 'image/jpeg' };
};

const getMediaCount = (mediaField) => {
  if (!mediaField) return 1;
  try {
    if (typeof mediaField === 'string' && (mediaField.startsWith('[') || mediaField.startsWith('{'))) {
      const parsed = JSON.parse(mediaField);
      if (Array.isArray(parsed)) return parsed.length;
      if (parsed && parsed.url) return 1; // Single object
    }
  } catch (e) { /* fallback */ }
  return 1;
};

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

  // Render Tags
  const tagsHTML = getPostTags(post).map(t => `
    <span class="card-tag">#${escapeHtml(t)}</span>
  `).join('');

  // Get first media object and count
  const firstMedia = getFirstMedia(post.image_url);
  const mediaCount = getMediaCount(post.image_url);

  const isVideo = firstMedia.type && firstMedia.type.startsWith('video/');
  const videoBadge = isVideo ? `<span class="photo-count-badge" style="left: 16px; right: auto;">▶ Video</span>` : '';
  const photoBadge = mediaCount > 1 ? `<span class="photo-count-badge">📷 ${mediaCount}</span>` : '';

  let mediaHtml = '';
  if (isVideo) {
    mediaHtml = `<video class="post-image" src="${firstMedia.url}" autoplay loop muted playsinline preload="metadata" style="pointer-events: none;"></video>`;
  } else {
    mediaHtml = `<img src="${firstMedia.url}" alt="Food" class="post-image" loading="lazy">`;
  }

  // The Card (a clickable link block)
  return `
    <a href="post.html?id=${post.id}" class="post-card ${isNew ? 'new-post' : ''}" id="post-${post.id}">
      ${deleteBtnHTML}
      <div class="post-image-wrapper">
        ${mediaHtml}
        ${videoBadge}
        ${photoBadge}
      </div>
      
      <div class="post-content">
        <h3 class="post-title">${escapeHtml(post.title || 'Untitled Recipe')}</h3>
        <p class="post-excerpt">${escapeHtml(excerpt)}</p>
        ${tagsHTML ? `<div class="card-tags">${tagsHTML}</div>` : ''}
        
        <div class="post-footer">
          <div class="post-stats">
            <span class="stat-item" title="Likes">
              ❤️ <span data-post-id="${post.id}" data-stat="likes">${post.likes_count || 0}</span>
            </span>
            <span class="stat-item" title="Comments">
              💬 <span data-post-id="${post.id}" data-stat="comments">${post.comments_count || 0}</span>
            </span>
          </div>
          <span class="post-date">${dateStr}</span>
        </div>
      </div>
    </a>
  `;
};

const renderSponsoredCard = (ad) => {
  const isVideo = ad.media_type === 'video';
  const mediaHtml = isVideo
    ? `<video class="post-image" src="${ad.media_url}" autoplay loop muted playsinline preload="metadata" style="pointer-events: none;"></video>`
    : `<img src="${ad.media_url}" alt="${escapeHtml(ad.title)}" class="post-image" loading="lazy">`;

  // Safely escape the URL to prevent breaking the HTML string if quotes exist in the DB
  const safeAdUrl = (ad.link_url || '#').replace(/["']/g, '');

  return `
    <div class="post-card sponsored-card" onclick="handleAdClick('${ad.id}', '${safeAdUrl}')" style="cursor: pointer;">
      <span class="sponsored-badge">Sponsored</span>
      <div class="post-image-wrapper">
        ${mediaHtml}
      </div>
      <div class="post-content">
        <h3 class="post-title" style="font-size: 22px;">${escapeHtml(ad.title)}</h3>
        ${ad.description ? `<p class="post-excerpt">${escapeHtml(ad.description)}</p>` : ''}
        <div class="post-footer">
          <span style="color: var(--color-accent); font-weight: 600; font-size: 13px;">${escapeHtml(ad.business_name || 'Local Business')}</span>
          ${ad.link_url ? `<span style="color: var(--color-accent); font-size: 13px;">Visit →</span>` : ''}
        </div>
      </div>
    </div>
  `;
};

window.handleAdClick = (adId, url) => {
  AdService.trackClick(adId);
  if (url && url !== '#' && url.trim() !== '') {
    // Prevent internal routing failure if admin forgot 'https://'
    let finalUrl = url.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }
    window.open(finalUrl, '_blank');
  }
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

const selectWeightedAd = (ads) => {
  if (ads.length === 0) return null;
  // Weight formula: inverse of impressions + 1 (to handle 0)
  // Ensures ads with FEWER impressions have a STRONGER weight (higher probability)
  const weights = ads.map(ad => 1 / ((ad.impression_count || 0) + 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let randomVal = Math.random() * totalWeight;
  for (let i = 0; i < ads.length; i++) {
    randomVal -= weights[i];
    if (randomVal <= 0) return ads[i];
  }
  return ads[Math.floor(Math.random() * ads.length)]; // Fallback
};

const selectRandomAd = (ads, storageKey) => {
  if (ads.length === 0) return null;
  if (ads.length === 1) return ads[0];

  let lastAdId = '';
  try {
    lastAdId = sessionStorage.getItem(storageKey) || '';
  } catch (_) {
    lastAdId = '';
  }

  const pool = ads.filter((ad) => ad.id !== lastAdId);
  const candidates = pool.length > 0 ? pool : ads;
  const selectedAd = candidates[Math.floor(Math.random() * candidates.length)];

  try {
    sessionStorage.setItem(storageKey, selectedAd.id);
  } catch (_) {
    // Ignore storage failures and still return a random ad.
  }

  return selectedAd;
};

const showMobileAdPopup = (ads) => {
  if (mobileAdShown || ads.length === 0) return;
  mobileAdShown = true;

  const ad = selectRandomAd(ads, LAST_MOBILE_AD_KEY);
  if (!ad) return;

  const popup = document.createElement('div');
  popup.className = 'mobile-ad-popup';

  const isVideo = ad.media_type === 'video';
  const mediaHtml = isVideo
    ? `<video src="${ad.media_url}" autoplay loop muted playsinline style="width:100%; max-height:280px; object-fit:cover; border-bottom:1px solid rgba(255,255,255,0.1);"></video>`
    : `<img src="${ad.media_url}" style="width:100%; max-height:280px; object-fit:cover; border-bottom:1px solid rgba(255,255,255,0.1);">`;

  // Safely escape the URL to prevent breaking the HTML string if quotes exist in the DB
  const safeAdUrl = (ad.link_url || '#').replace(/["']/g, '');

  popup.innerHTML = `
    <div class="mobile-ad-content" onclick="handleAdClick('${ad.id}', '${safeAdUrl}')">
      <button id="mobileAdCloseBtn" class="mobile-ad-close" disabled>5</button>
      ${mediaHtml}
      <div style="padding: 24px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; background: var(--color-accent); color: white; padding: 4px 10px; border-radius: var(--radius-pill); box-shadow: 0 2px 8px var(--color-accent-glow);">Sponsored</span>
        <h3 style="margin: 16px 0 8px; font-family:var(--font-display); font-size:24px; color:var(--color-text); line-height:1.2;">${escapeHtml(ad.title)}</h3>
        <p style="margin:0 0 20px; font-size:15px; line-height:1.5; color:var(--color-text-secondary);">${escapeHtml(ad.description || '')}</p>
        <div style="font-weight:600; color:var(--color-accent); font-size:15px; display:inline-block; padding: 8px 16px; background:var(--color-accent-light); border-radius:var(--radius-pill);">${escapeHtml(ad.business_name || 'Visit Site')} →</div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);
  AdService.trackImpression(ad.id);

  setTimeout(() => popup.classList.add('active'), 50);

  const closeBtn = popup.querySelector('#mobileAdCloseBtn');
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    popup.classList.remove('active');
    setTimeout(() => popup.remove(), 350);
  };

  let timeLeft = 5;
  const timer = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(timer);
      closeBtn.innerText = '✕';
      closeBtn.disabled = false;
    } else {
      closeBtn.innerText = timeLeft;
    }
  }, 1000);
};

// Main render pipeline based on FilterState
const renderFeed = async () => {
  if (FilterState.page === 1) renderSkeletons();

  try {
    const fetchedPosts = await withRetry(() => PostService.fetchAll(FilterState));
    const fetchedPostIds = new Set(fetchedPosts.map((post) => post.id));
    realtimePostBuffer.forEach((post, id) => {
      if (fetchedPostIds.has(id)) {
        realtimePostBuffer.delete(id);
      }
    });

    const recentRaw = sessionStorage.getItem('hfhs_recent_post');
    if (recentRaw) {
      try {
        const parsed = JSON.parse(recentRaw);
        const recentPost = parsed?.post || parsed;
        if (recentPost?.id && fetchedPostIds.has(recentPost.id)) {
          sessionStorage.removeItem('hfhs_recent_post');
        }
      } catch (_) {
        sessionStorage.removeItem('hfhs_recent_post');
      }
    }

    const posts = mergeRealtimePosts(fetchedPosts, FilterState);

    if (posts.length === 0) {
      if (FilterState.page === 1) {
        renderEmptyState();
      }
      return 0;
    }

    const html = posts.map(p => renderCard(p)).join('');

    if (FilterState.page === 1) {
      const feedAds = AdService.getFeedAds();
      if (feedAds.length > 0) {
        if (window.innerWidth < 768) {
          // MOBILE APP-STYLE: Don't inject in feed. Show a popup!
          feedGrid.innerHTML = html;
          setTimeout(() => showMobileAdPopup(feedAds), 2500);
        } else {
          // DESKTOP: Shuffle active ads so placements feel fresh on each render.
          const cards = posts.map(p => renderCard(p));
          const randomizedFeedAds = [...feedAds].sort(() => Math.random() - 0.5);
          let adInjections = 0;
          const merged = [];
          cards.forEach((card, i) => {
            merged.push(card);
            if ((i + 1) % 3 === 0 && adInjections < randomizedFeedAds.length) {
              const selectedAd = randomizedFeedAds[adInjections];
              merged.push(renderSponsoredCard(selectedAd));
              AdService.trackImpression(selectedAd.id);
              adInjections++;
            }
          });
          feedGrid.innerHTML = merged.join('');
        }
      } else {
        feedGrid.innerHTML = html;
      }
    } else {
      feedGrid.insertAdjacentHTML('beforeend', html);
    }

    return posts.length;

  } catch (err) {
    showToast(STRINGS.errorLoad, 'error');
    console.error(err);
    return 0;
  }
};

/* === EVENT HANDLERS === */

// Realtime Injection Handlers
const handleNewPostArrival = (post) => {
  realtimePostBuffer.set(post.id, post);

  // Only inject if matching current search/filter vaguely, or always drop at top 
  // if on 'latest' to keep it feeling magical!
  if (FilterState.activeFilter === 'latest' && FilterState.page === 1 && matchesSearchTerm(post, FilterState.searchTerm)) {
    if (document.getElementById(`post-${post.id}`)) return;
    feedGrid.insertAdjacentHTML('afterbegin', renderCard(post, true));
  }
};

const handleUpdatePostArrival = (post) => {
  if (post?.id) {
    realtimePostBuffer.set(post.id, {
      ...(realtimePostBuffer.get(post.id) || {}),
      ...post
    });
  }

  const likeSpan = document.querySelector(`span[data-post-id="${post.id}"][data-stat="likes"]`);
  if (likeSpan) likeSpan.innerText = post.likes_count || 0;

  const commentSpan = document.querySelector(`span[data-post-id="${post.id}"][data-stat="comments"]`)
    || document.querySelector(`#post-${post.id} .stat-item:nth-child(2) span`);
  if (commentSpan) commentSpan.innerText = post.comments_count || 0;

  if (
    FilterState.page === 1 &&
    (FilterState.activeFilter === 'most_liked' || FilterState.activeFilter === 'most_commented')
  ) {
    clearTimeout(sortRefreshTimeout);
    sortRefreshTimeout = setTimeout(() => {
      renderFeed();
    }, 250);
  }
};

// Admin DOM deletion 
const removeCardFromDOM = (id) => {
  realtimePostBuffer.delete(id);
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
  hasMore = true;
  renderFeed();
};
window.handleFilterChange = handleFilterChange;

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
  if (e) e.preventDefault();
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
    isAdmin = window.revealAdminUI(currentUser);
  }

  // 3. Attach Listeners
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  hydrateRecentPostFromSession();

  // 4. Initial Fetch
  await AdService.fetchActive();
  await renderFeed();

  // 4.5 Render sidebar ads
  renderSidebarAds();

  // 5. Setup Infinite Scroll
  setupInfiniteScroll();

  // 6. Setup Live Subscription
  PostService.subscribeToUpdates(handleNewPostArrival, handleUpdatePostArrival);
};

/* === DYNAMIC SIDEBAR ADS === */
function renderSidebarAds() {
  const sidebarAds = AdService.getSidebarAds();
  const adBannerEl = document.querySelector('.ad-banner');
  if (!adBannerEl || sidebarAds.length === 0) return;

  const ad = sidebarAds[0]; // Show the first sidebar ad
  const isVideo = ad.media_type === 'video';

  adBannerEl.onclick = () => {
    AdService.trackClick(ad.id);
    if (ad.link_url) {
      const finalUrl = ad.link_url.startsWith('http://') || ad.link_url.startsWith('https://')
        ? ad.link_url
        : `https://${ad.link_url}`;
      window.open(finalUrl, '_blank');
    }
  };

  adBannerEl.innerHTML = `
    ${isVideo
      ? `<video src="${ad.media_url}" autoplay loop muted playsinline style="width:100%; border-radius:12px; margin-bottom:12px; max-height:160px; object-fit:cover;"></video>`
      : `<img src="${ad.media_url}" alt="${escapeHtml(ad.title)}" style="width:100%; border-radius:12px; margin-bottom:12px; max-height:160px; object-fit:cover;">`
    }
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-accent); background: var(--color-accent-light); padding: 2px 8px; border-radius: 4px;">Sponsored</span>
    </div>
    <h4 style="margin: 0 0 6px 0; font-family: var(--font-display); font-size: 16px; color: var(--color-text);">${escapeHtml(ad.title)}</h4>
    <p style="margin: 0 0 10px 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.4;">${escapeHtml(ad.description || '')}</p>
    <div style="color: var(--color-accent); font-weight: 600; font-size: 13px;">${escapeHtml(ad.business_name || 'Learn More')} →</div>
  `;

  AdService.trackImpression(ad.id);
}

function setupInfiniteScroll() {
  if (!feedGrid || document.getElementById(scrollSentinel.id)) return;

  feedGrid.after(scrollSentinel);
  const observer = new IntersectionObserver(async (entries) => {
    const [entry] = entries;
    if (!entry?.isIntersecting || isFetching || !hasMore) return;

    isFetching = true;
    try {
      FilterState.page += 1;
      const loadedCount = await renderFeed();

      if (loadedCount === 0) {
        hasMore = false;
        FilterState.page -= 1;
      }
    } finally {
      isFetching = false;
    }
  }, { rootMargin: '200px 0px' });

  observer.observe(scrollSentinel);
}

document.addEventListener('DOMContentLoaded', initFeed);
