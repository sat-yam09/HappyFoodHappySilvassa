/* ============================================================
   POST DATA LAYER & INTERACTIONS — HappyFoodHappySilvassa
   Handles likes, comments, and realtime data fetching.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

const STRINGS = {
  copySuccess: "Copied! ✓",
  copyFail: "Copy failed",
  deleteConfirm:
    "Are you sure you want to delete this post? This cannot be undone.",
  commentDeleteConfirm: "Delete this comment?",
  sessionExpired: "Session expired. Please log in again.",
  errorLoading: "Failed to load post. It may have been deleted.",
};

/* === GLOBAL STATE === */
let currentUser = null;
let isAdmin = false;
let currentPostId = new URLSearchParams(window.location.search).get("id");
let hasLiked = false;

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/* === REDIRECT IF NO ID === */
if (!currentPostId) window.location.href = "feed.html";

/* === DATA LAYER: Fetching Core Post === */
const fetchPost = async () => {
  const { data, error } = await sb
    .from("posts")
    .select("*")
    .eq("id", currentPostId)
    .single();
  if (error || !data) {
    showToast(STRINGS.errorLoading, "error");
    setTimeout(() => (window.location.href = "feed.html"), 2000);
    throw error;
  }
  return data;
};

const getCountValue = (elementId) => {
  const raw = parseInt(document.getElementById(elementId)?.innerText || "0", 10);
  return Number.isFinite(raw) ? raw : 0;
};

const setCountValue = (elementId, nextValue) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerText = Math.max(0, nextValue);
};

const PostMutationService = {
  async addLike() {
    const { data, error } = await sb
      .from("likes")
      .insert([{ post_id: currentPostId, user_id: currentUser.id }])
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Like could not be saved.");
  },

  async removeLike() {
    const { data, error } = await sb
      .from("likes")
      .delete()
      .eq("post_id", currentPostId)
      .eq("user_id", currentUser.id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Like could not be removed.");
  },

  async addComment(payload) {
    const { data, error } = await sb
      .from("comments")
      .insert([payload])
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeComment(commentId) {
    const { data, error } = await sb
      .from("comments")
      .delete()
      .eq("id", commentId)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Comment could not be deleted.");
  },

  async deleteCurrentPost() {
    const { data, error } = await sb
      .from("posts")
      .delete()
      .eq("id", currentPostId)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Post could not be deleted.");
  }
};

/* === INTERACTION: LIKES === */
const LikeService = {
  isToggling: false,

  async fetchInitialState(userId) {
    const { data, error } = await sb
      .from("likes")
      .select("id")
      .eq("post_id", currentPostId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    hasLiked = !!data;
    this.renderUI();
  },

  async toggle() {
    if (this.isToggling) return; // Prevent double-clicks

    // Session Guard for Like Interaction
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      showToast(STRINGS.sessionExpired, "error");
      setTimeout(() => (window.location.href = "index.html"), 1500);
      return;
    }

    this.isToggling = true;
    const btn = document.getElementById("likeBtn");

    // 1. Optimistic UI Update (Instant Feedback)
    hasLiked = !hasLiked;
    this.renderUI();
    btn.classList.add("animating"); // trigger pop animation
    setTimeout(() => btn.classList.remove("animating"), 400); // 400ms match CSS

    const currentCount = getCountValue("likeCount");
    setCountValue("likeCount", hasLiked ? currentCount + 1 : currentCount - 1);

    try {
      if (hasLiked) {
        await PostMutationService.addLike();
      } else {
        await PostMutationService.removeLike();
      }
    } catch (err) {
      console.warn("Like sync failed, rolling back.", err);
      // Rollback Optimistic UI
      hasLiked = !hasLiked;
      this.renderUI();
      setCountValue("likeCount", currentCount);
      showToast("Could not sync like. Please try again.", "error");
    } finally {
      this.isToggling = false;
    }
  },

  renderUI() {
    const btn = document.getElementById("likeBtn");
    if (hasLiked) {
      btn.classList.add("liked");
      btn.innerHTML = `❤️ <span id="likeCount">${document.getElementById("likeCount")?.innerText || "..."}</span>`;
    } else {
      btn.classList.remove("liked");
      btn.innerHTML = `🤍 <span id="likeCount">${document.getElementById("likeCount")?.innerText || "..."}</span>`;
    }
  },
};
window.LikeService = LikeService;

/* === INTERACTION: COMMENTS === */
const CommentService = {
  async fetchAll() {
    const { data, error } = await sb
      .from("comments")
      .select("*")
      .eq("post_id", currentPostId)
      .order("created_at", { ascending: true }); // oldest first (reading down)
    if (error) throw error;
    return data;
  },

  async post(content) {
    if (!content.trim()) return;

    // Session Guard
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      showToast(STRINGS.sessionExpired, "error");
      return;
    }

    const input = document.getElementById("commentInput");
    const submitBtn = document.getElementById("commentSubmitBtn");

    input.disabled = true;
    submitBtn.innerText = "Posting...";

    // Optimistic UI ID
    const optimisticId = "opt-" + Date.now();
    const optimisticComment = {
      id: optimisticId,
      user_id: currentUser.id,
      user_name: currentUser.user_metadata.full_name || "User",
      content: content,
      created_at: new Date().toISOString(),
      parent_id: null, // foundation for threaded nested comments later
    };

    // Inject to DOM immediately
    document
      .getElementById("commentList")
      .insertAdjacentHTML(
        "beforeend",
        renderCommentHTML(optimisticComment, true),
      );
    input.value = "";
    setCountValue("displayCommentCount", getCountValue("displayCommentCount") + 1);

    try {
      await PostMutationService.addComment({
        post_id: currentPostId,
        user_id: currentUser.id,
        user_name: optimisticComment.user_name,
        content: content,
      });
    } catch (err) {
      const optimisticEl = document.getElementById(optimisticId);
      if (optimisticEl) optimisticEl.remove();
      setCountValue("displayCommentCount", getCountValue("displayCommentCount") - 1);
      console.error(err);
      showToast("Failed to post comment.", "error");
    } finally {
      input.disabled = false;
      submitBtn.innerText = "Post Comment";
    }
  },

  async delete(commentId) {
    showConfirmModal({
      title: "Delete Comment?",
      text: "Are you sure you want to remove this comment?",
      onConfirm: async () => {
        try {
          await PostMutationService.removeComment(commentId);
          animateDeleteDOM("comment-" + commentId);
          setCountValue("displayCommentCount", getCountValue("displayCommentCount") - 1);
        } catch (err) {
          console.error("Failed to delete comment:", err);
          showToast("Failed to delete comment.", "error");
        }
      },
    });
  },
};
window.CommentService = CommentService;

/* === REALTIME: SYNCING THE PAGE FOR EVERYONE === */
const RealtimeService = {
  subscription: null,

  start() {
    this.subscription = sb
      .channel(`public:post:${currentPostId}`)

      // 1. Sync Like/Comment Counts jumping up and down
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "posts",
          filter: `id=eq.${currentPostId}`,
        },
        (payload) => {
          document.getElementById("likeCount").innerText =
            payload.new.likes_count || 0;
          document.getElementById("displayCommentCount").innerText =
            payload.new.comments_count || 0;
        },
      )

      // 2. Sync New Comments arriving live
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${currentPostId}`,
        },
        (payload) => {
          // If we rendered an optimistic chunk, remove it so we don't duel
          const list = document.getElementById("commentList");
          const optimistics = list.querySelectorAll(".optimistic");
          optimistics.forEach((el) => el.remove());

          list.insertAdjacentHTML("beforeend", renderCommentHTML(payload.new));
        },
      )

      // 3. Sync Comment Deletions done by Admins or Users elsewhere
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${currentPostId}`,
        },
        (payload) => {
          animateDeleteDOM("comment-" + payload.old.id);
        },
      )

      // 4. Emergency Redirect: If the ADMIN deletes this post while someone is reading it
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "posts",
          filter: `id=eq.${currentPostId}`,
        },
        (payload) => {
          showToast("This post was just deleted.", "error");
          setTimeout(() => (window.location.href = "feed.html"), 2000);
        },
      )

      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          const dot = document.getElementById("rt-status-dot");
          if (dot) dot.remove();
        }
        if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          showRealtimeDisconnectDot();
        }
      });
  },
};



/* === UI RENDER HELPERS === */
const renderCommentHTML = (c, isOptimistic = false) => {
  const dateStr = new Date(c.created_at).toLocaleDateString();
  const classes = isOptimistic ? "comment-card optimistic" : "comment-card";
  const eleId = isOptimistic ? c.id : `comment-${c.id}`;

  // Can Delete? Only if we are Admin OR we own the comment
  const canDelete = isAdmin || (currentUser && currentUser.id === c.user_id);
  const delBtn = canDelete
    ? `<button class="comment-delete-btn" onclick="CommentService.delete('${c.id}')"><svg width="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>`
    : "";

  return `
    <div class="${classes}" id="${eleId}">
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(c.user_name || "Anonymous")}</span>
        <span class="comment-date">${dateStr}</span>
        ${delBtn}
      </div>
      <div class="comment-text">${linkifyText(c.content || "")}</div>
    </div>
  `;
};

const animateDeleteDOM = (elementId) => {
  const el = document.getElementById(elementId);
  if (el) {
    el.style.opacity = "0";
    el.style.height = "0";
    el.style.padding = "0";
    el.style.margin = "0";
    setTimeout(() => el.remove(), 300);
  }
};

const renderPostBody = (content) => {
  const text = (content || "").trim();
  if (!text) return "<p>No content provided.</p>";

  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${linkifyText(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
};

/* === SHARE UTILITIES === */
window.handleShareWA = () => {
  const title = document.getElementById("postTitle").innerText;
  const url = window.location.href;
  window.open(
    `https://wa.me/?text=${encodeURIComponent(title + " — Read more at: " + url)}`,
  );
};

window.handleShareCopy = async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    const btn = document.getElementById("shareCopyBtn");
    btn.innerHTML = `🔗 ${STRINGS.copySuccess}`;
    setTimeout(() => (btn.innerHTML = `🔗 Copy Link`), 2000);
  } catch (err) {
    showToast(STRINGS.copyFail, "error");
  }
};

/* === ADMIN CONTROLS === */
window.handleAdminDeletePost = async () => {
  showConfirmModal({
    title: "Delete Entire Post?",
    text: "This action is irreversible. All likes and comments will also be lost.",
    onConfirm: async () => {
      try {
        await PostMutationService.deleteCurrentPost();
        window.location.href = "feed.html";
      } catch (err) {
        showToast("Could not delete post.", "error");
      }
    },
  });
};

/* === MEDIA PARSER (handles old string strings and new media objects) === */
const parseMediaUrls = (mediaField) => {
  if (!mediaField) return [{ url: 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3', type: 'image/jpeg' }];

  try {
    if (typeof mediaField === 'string' && (mediaField.startsWith('[') || mediaField.startsWith('{'))) {
      const parsed = JSON.parse(mediaField);
      // Array of media objects
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(item => {
          if (typeof item === 'string') return { url: item, type: 'image/jpeg' };
          return item; // already {url, type}
        });
      }
      // Single media object stored as JSON string
      if (parsed && parsed.url) return [parsed];
    }
  } catch (e) { /* fallback */ }

  if (typeof mediaField === 'string') {
    return [{ url: mediaField, type: 'image/jpeg' }];
  } else if (typeof mediaField === 'object' && mediaField.url) {
    return [mediaField];
  }

  return [{ url: 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3', type: 'image/jpeg' }];
};

/* === LINKIFY: Convert URLs in text to clickable links === */
const linkifyText = (text) => {
  if (!text) return '';
  // Regex to match URLs (http, https, and www)
  const urlRegex = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  // Escape HTML first to prevent XSS
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(urlRegex, (url) => {
    const href = url.startsWith('www.') ? 'https://' + url : url;
    // Truncate display if super long
    const display = url.length > 60 ? url.substring(0, 57) + '...' : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${display}</a>`;
  });
};

/* === CAROUSEL STATE === */
let carouselImages = [];
let carouselIndex = 0;

/* === CAROUSEL SETUP === */
const setupCarousel = (mediaArray) => {
  carouselImages = mediaArray; // Now holding array of {url, type} objects
  const track = document.getElementById('carouselTrack');
  const dots = document.getElementById('carouselDots');
  const carousel = document.getElementById('heroCarousel');
  if (!track || !dots || !carousel) return;

  // Build slides (handle videos vs images)
  track.innerHTML = mediaArray.map((media, i) => {
    let mediaEl = '';
    const isVideo = media.type && media.type.startsWith('video/');

    if (isVideo) {
      mediaEl = `
        <video src="${media.url}" autoplay loop muted playsinline preload="metadata"></video>
        <div class="video-indicator">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg>
        </div>
      `;
    } else {
      mediaEl = `<img src="${media.url}" alt="Post photo ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">`;
    }

    return `
      <div class="carousel-slide" onclick="openLightbox(${i})">
        ${mediaEl}
      </div>
    `;
  }).join('');

  // Build dots
  dots.innerHTML = mediaArray.map((_, i) => `
    <button class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="goToSlide(${i})"></button>
  `).join('');

  // Multi-image mode
  if (mediaArray.length > 1) {
    carousel.classList.add('multi');
  }

  // Setup touch swipe for mobile
  setupCarouselSwipe(track);
};

const goToSlide = (index) => {
  const total = carouselImages.length;
  carouselIndex = Math.max(0, Math.min(index, total - 1));

  const track = document.getElementById('carouselTrack');
  if (!track) return;
  track.style.transform = `translateX(-${carouselIndex * 100}%)`;

  // Update dots
  document.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === carouselIndex);
  });
};

window.carouselNav = (direction) => {
  goToSlide(carouselIndex + direction);
};

window.goToSlide = goToSlide;

/* === TOUCH/SWIPE for carousel === */
const setupCarouselSwipe = (trackEl) => {
  let startX = 0, startY = 0, isDragging = false, diffX = 0;

  trackEl.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
    trackEl.style.transition = 'none';
  }, { passive: true });

  trackEl.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    diffX = e.touches[0].clientX - startX;
    const diffY = e.touches[0].clientY - startY;

    // If scrolling more vertically, don't hijack
    if (Math.abs(diffY) > Math.abs(diffX)) { isDragging = false; return; }

    const offset = -(carouselIndex * trackEl.parentElement.offsetWidth) + diffX;
    trackEl.style.transform = `translateX(${offset}px)`;
  }, { passive: true });

  trackEl.addEventListener('touchend', () => {
    if (!isDragging) { trackEl.style.transition = ''; goToSlide(carouselIndex); return; }
    isDragging = false;
    trackEl.style.transition = '';

    const threshold = 50;
    if (diffX < -threshold) { goToSlide(carouselIndex + 1); }
    else if (diffX > threshold) { goToSlide(carouselIndex - 1); }
    else { goToSlide(carouselIndex); }
    diffX = 0;
  }, { passive: true });
};


/* === LIGHTBOX STATE & LOGIC === */
let lightboxIndex = 0;

window.openLightbox = (index) => {
  lightboxIndex = index;
  const overlay = document.getElementById('lightboxOverlay');

  // Need to dynamically swap the element type for the lightbox
  const media = carouselImages[index];
  const oldMediaEl = document.getElementById('lightboxMediaEl');
  if (oldMediaEl) oldMediaEl.remove();

  const isVideo = media.type && media.type.startsWith('video/');
  let newMediaEl;
  if (isVideo) {
    newMediaEl = document.createElement('video');
    newMediaEl.src = media.url;
    newMediaEl.controls = true;
    newMediaEl.autoplay = true;
    newMediaEl.loop = true;
    newMediaEl.className = 'lightbox-content';
  } else {
    newMediaEl = document.createElement('img');
    newMediaEl.src = media.url;
    newMediaEl.alt = 'Full size media';
    newMediaEl.className = 'lightbox-content';
  }
  newMediaEl.id = 'lightboxMediaEl';
  overlay.insertBefore(newMediaEl, document.getElementById('lightboxPrev'));

  if (carouselImages.length > 1) {
    overlay.classList.add('multi');
    document.getElementById('lightboxCounter').innerText = `${index + 1} / ${carouselImages.length}`;
  }

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Setup lightbox swipe
  setupLightboxSwipe();
};

window.closeLightbox = (e) => {
  if (e && e.target !== e.currentTarget && !e.target.closest('.lightbox-close')) return;
  const overlay = document.getElementById('lightboxOverlay');
  overlay.classList.remove('active', 'multi');
  document.body.style.overflow = '';
};

window.lightboxNav = (e, direction) => {
  e.stopPropagation();
  lightboxIndex = Math.max(0, Math.min(lightboxIndex + direction, carouselImages.length - 1));
  openLightbox(lightboxIndex); // Reusing open to handle media toggle elegantly
};

const setupLightboxSwipe = () => {
  const overlay = document.getElementById('lightboxOverlay');
  let startX = 0, diffX = 0;

  const onTouchStart = (e) => { startX = e.touches[0].clientX; };
  const onTouchMove = (e) => { diffX = e.touches[0].clientX - startX; };
  const onTouchEnd = () => {
    if (diffX < -50) { lightboxNav({ stopPropagation: () => { } }, 1); }
    else if (diffX > 50) { lightboxNav({ stopPropagation: () => { } }, -1); }
    diffX = 0;
  };

  // Remove old listeners by replacing element (simple approach)
  overlay.removeEventListener('touchstart', overlay._lbts);
  overlay.removeEventListener('touchmove', overlay._lbtm);
  overlay.removeEventListener('touchend', overlay._lbte);
  overlay._lbts = onTouchStart; overlay._lbtm = onTouchMove; overlay._lbte = onTouchEnd;
  overlay.addEventListener('touchstart', onTouchStart, { passive: true });
  overlay.addEventListener('touchmove', onTouchMove, { passive: true });
  overlay.addEventListener('touchend', onTouchEnd, { passive: true });
};

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  const lightbox = document.getElementById('lightboxOverlay');
  if (!lightbox.classList.contains('active')) return;

  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNav({ stopPropagation: () => { } }, -1);
  if (e.key === 'ArrowRight') lightboxNav({ stopPropagation: () => { } }, 1);
});


/* === INITIALIZATION CORE === */
const initPostPage = async () => {
  // 1. Session check
  await checkSession(null, "index.html");
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) {
    currentUser = user;
    isAdmin = window.isAdminUser(user);
  }

  // 2. Fetch Post UI Injection (with Retry)
  const post = await withRetry(() => fetchPost());

  // Inject visual data
  document.title = `${post.title} - HappyFood`;

  // Dynamic SEO Updates
  const metaTitle = document.getElementById('metaOgTitle');
  if (metaTitle) metaTitle.content = post.title;

  // Parse images (mixed media objects support)
  const mediaArray = parseMediaUrls(post.image_url);

  const metaImage = document.getElementById('metaOgImage');
  if (metaImage && mediaArray[0]) metaImage.content = mediaArray[0].url;

  // Setup image carousel
  setupCarousel(mediaArray);

  document.getElementById("postTitle").innerText =
    post.title || "Untitled Post";
  document.getElementById("postDate").innerText = new Date(
    post.created_at,
  ).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  document.getElementById("likeCount").innerText = post.likes_count || 0;
  document.getElementById("displayCommentCount").innerText =
    post.comments_count || 0;

  // Clean injected content (raw HTML output placeholder for Rich Text Day 4)
  document.getElementById("postContentBox").innerHTML = renderPostBody(post.content);

  // Show Admin Actions
  if (isAdmin) {
    document.getElementById("adminControls").classList.add("admin-visible");
  }

  // 3. Init Interactions
  if (currentUser?.id) {
    LikeService.fetchInitialState(currentUser.id);
  }

  // 4. Init Comments (with Retry)
  const comments = await withRetry(() => CommentService.fetchAll());
  document.getElementById("commentList").innerHTML = comments
    .map((c) => renderCommentHTML(c))
    .join("");

  // 5. Subscribe to Realtime Data
  RealtimeService.start();
};

document.addEventListener("DOMContentLoaded", initPostPage);
