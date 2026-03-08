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

/* === INTERACTION: LIKES === */
const LikeService = {
  isToggling: false,

  async fetchInitialState(userId) {
    const { data } = await sb
      .from("likes")
      .select("id")
      .eq("post_id", currentPostId)
      .eq("user_id", userId)
      .single();
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

    const currentCount = parseInt(
      document.getElementById("likeCount").innerText,
    );
    document.getElementById("likeCount").innerText = hasLiked
      ? currentCount + 1
      : currentCount - 1;

    try {
      if (hasLiked) {
        // Insert Like and incrementally update count via RPC
        await sb
          .from("likes")
          .insert([{ post_id: currentPostId, user_id: currentUser.id }]);
        await sb.rpc("increment_like_count", { post_id: currentPostId });
      } else {
        // Delete Like and decrementally update count via RPC
        await sb
          .from("likes")
          .delete()
          .eq("post_id", currentPostId)
          .eq("user_id", currentUser.id);
        await sb.rpc("decrement_like_count", { post_id: currentPostId });
      }
    } catch (err) {
      console.warn("RPC failed or Like failed, rolling back.", err);
      // Rollback Optimistic UI
      hasLiked = !hasLiked;
      this.renderUI();
      document.getElementById("likeCount").innerText = currentCount;
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

  async post(content, parentId = null) {
    if (!content.trim()) return;

    // Session Guard
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      showToast(STRINGS.sessionExpired, "error");
      return;
    }

    const isReply = parentId !== null;
    const input = isReply ? document.getElementById(`replyInput-${parentId}`) : document.getElementById("commentInput");
    const submitBtn = isReply ? document.getElementById(`replySubmitBtn-${parentId}`) : document.getElementById("commentSubmitBtn");

    if (input) input.disabled = true;
    if (submitBtn) submitBtn.innerText = "Posting...";

    // Optimistic UI ID
    const optimisticId = "opt-" + Date.now();
    const optimisticComment = {
      id: optimisticId,
      user_id: currentUser.id,
      user_name: currentUser.user_metadata.full_name || "User",
      content: content,
      created_at: new Date().toISOString(),
      parent_id: parentId, // support for threaded nest
    };

    // Inject to DOM immediately
    if (isReply) {
      const repliesContainer = document.getElementById(`replies-${parentId}`);
      if (repliesContainer) {
        repliesContainer.insertAdjacentHTML("beforeend", renderCommentHTML(optimisticComment, true, true));
      }
      // Hide reply form
      window.toggleReplyForm(parentId);
    } else {
      document
        .getElementById("commentList")
        .insertAdjacentHTML("beforeend", renderCommentHTML(optimisticComment, true, false) + `<div class="replies-container" id="replies-${optimisticId}"></div>`);
    }
    
    if (input) input.value = "";

    try {
      // Send to Supabase
      const { error } = await sb.from("comments").insert([
        {
          post_id: currentPostId,
          user_id: currentUser.id,
          user_name: optimisticComment.user_name,
          content: content,
          parent_id: parentId
        },
      ]);

      if (error) throw error;

      // Update the post's total comment count natively
      await sb.rpc("increment_comment_count", { post_id: currentPostId });

      // Note: we don't need to manually remove the optimistic one because
      // the REALTIME subscription will trigger an INSERT event and overwrite this thread cleanly
      // in a full scale app. But for simplicity here, we let the realtime handler just do its job.
    } catch (err) {
      document.getElementById(optimisticId).innerHTML +=
        `<p style="color:red;font-size:12px;">Failed to post.</p>`;
      console.error(err);
    } finally {
      if (input) input.disabled = false;
      if (submitBtn) submitBtn.innerText = isReply ? "Reply" : "Post Comment";
    }
  },

  async delete(commentId) {
    showConfirmModal({
      title: "Delete Comment?",
      text: "Are you sure you want to remove this comment?",
      onConfirm: async () => {
        try {
          // Delete visually
          animateDeleteDOM("comment-" + commentId);

          // Delete from DB & Dec backend counter
          await sb.from("comments").delete().eq("id", commentId);
          await sb.rpc("decrement_comment_count", { post_id: currentPostId });
        } catch (err) {
          console.error("Failed to delete comment:", err);
          showToast("Failed to delete comment.", "error");
        }
      },
    });
  },
};

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

          const newComment = payload.new;
          // In an advanced app, we'd replace the optimistic ID with real DB ID.
          // For now, if someone else posted, drop it in. Avoid self-duplicates via a robust check,
          // but optimistic simplicity is fine currently for HFHS.
          if (newComment.user_id !== currentUser?.id) {
            if (newComment.parent_id) {
              const repliesContainer = document.getElementById(`replies-${newComment.parent_id}`);
              if (repliesContainer) {
                repliesContainer.insertAdjacentHTML(
                  "beforeend",
                  renderCommentHTML(newComment, false, true),
                );
              }
            } else {
              document
                .getElementById("commentList")
                .insertAdjacentHTML(
                  "beforeend",
                  renderCommentHTML(newComment, false, false) + `<div class="replies-container" id="replies-${newComment.id}"></div>`,
                );
            }
          }
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



/* === HELPER: BUILD NESTED TREE === */
const buildCommentTree = (comments) => {
  const commentMap = {};
  const rootComments = [];
  
  comments.forEach(c => {
    c.replies = [];
    commentMap[c.id] = c;
  });
  
  comments.forEach(c => {
    if (c.parent_id && commentMap[c.parent_id]) {
      commentMap[c.parent_id].replies.push(c);
    } else {
      rootComments.push(c);
    }
  });
  
  return rootComments;
};

const renderCommentTreeHTML = (comments) => {
  return comments.map(c => `
    ${renderCommentHTML(c, false, !!c.parent_id)}
    <div class="replies-container" id="replies-${c.id}">
      ${c.replies && c.replies.length > 0 ? renderCommentTreeHTML(c.replies) : ''}
    </div>
  `).join('');
};

/* === UI RENDER HELPERS === */
const renderCommentHTML = (c, isOptimistic = false, isNested = false) => {
  const dateStr = new Date(c.created_at).toLocaleDateString();
  let classes = isOptimistic ? "comment-card optimistic" : "comment-card";
  if (isNested) classes += " nested";
  
  const eleId = isOptimistic ? c.id : `comment-${c.id}`;

  // Can Delete? Only if we are Admin OR we own the comment
  const canDelete = isAdmin || (currentUser && currentUser.id === c.user_id);
  const delBtn = canDelete
    ? `<button class="comment-delete-btn" onclick="CommentService.delete('${c.id}')"><svg width="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>`
    : "";
    
  // Reply Button & Form (only allow 1 level deep nesting to keep UI clean, or allow infinite)
  // We'll allow replying to both root and child, but all child replies attach to the parent for flat trees,
  // or just nest deeply. Let's do simple infinite nesting.
  const replyActionHTML = currentUser && !isOptimistic 
    ? `
      <button class="reply-btn" onclick="toggleReplyForm('${c.id}')">
        <svg width="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg> Reply
      </button>
      <div class="reply-form" id="reply-form-${c.id}">
        <textarea id="replyInput-${c.id}" class="comment-input" style="min-height: 60px; padding: 10px; font-size: 14px; margin-top: 10px;" placeholder="Write a reply..."></textarea>
        <div style="text-align: right; margin-top: 8px;">
          <button id="replySubmitBtn-${c.id}" class="comment-submit" style="position: static; padding: 6px 16px; font-size: 13px;" onclick="CommentService.post(document.getElementById('replyInput-${c.id}').value, '${c.id}')">Reply</button>
        </div>
      </div>
    ` : '';

  return `
    <div class="${classes}" id="${eleId}">
      <div class="comment-meta">
        <span class="comment-author">${c.user_name || "Anonymous"}</span>
        <span class="comment-date">${dateStr}</span>
        ${delBtn}
      </div>
      <div class="comment-text">${c.content}</div>
      ${replyActionHTML}
    </div>
  `;
};

window.toggleReplyForm = (commentId) => {
  const form = document.getElementById(`reply-form-${commentId}`);
  if (form) {
    // Only toggle if they are logged in.
    if (!currentUser) {
      showToast('Please log in to reply.', 'error');
      return;
    }
    form.classList.toggle('active');
  }
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
        await sb.from("posts").delete().eq("id", currentPostId);
        window.location.href = "feed.html";
      } catch (err) {
        showToast("Could not delete post.", "error");
      }
    },
  });
};

/* === IMAGE URL PARSER (backward compatible) === */
const parseImageUrls = (imageUrlField) => {
  if (!imageUrlField) return ['https://images.unsplash.com/photo-1495195134817-a165bd39e4e3'];
  // Try JSON array parse
  try {
    if (imageUrlField.startsWith('[')) {
      const parsed = JSON.parse(imageUrlField);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { /* not JSON, treat as single URL */ }
  return [imageUrlField];
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
const setupCarousel = (urls) => {
  carouselImages = urls;
  const track = document.getElementById('carouselTrack');
  const dots = document.getElementById('carouselDots');
  const carousel = document.getElementById('heroCarousel');

  // Build slides
  track.innerHTML = urls.map((url, i) => `
    <div class="carousel-slide" onclick="openLightbox(${i})">
      <img src="${url}" alt="Post photo ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">
    </div>
  `).join('');

  // Build dots
  dots.innerHTML = urls.map((_, i) => `
    <button class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="goToSlide(${i})"></button>
  `).join('');

  // Multi-image mode
  if (urls.length > 1) {
    carousel.classList.add('multi');
  }

  // Setup touch swipe for mobile
  setupCarouselSwipe(track);
};

const goToSlide = (index) => {
  const total = carouselImages.length;
  carouselIndex = Math.max(0, Math.min(index, total - 1));
  
  const track = document.getElementById('carouselTrack');
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
  document.getElementById('lightboxImg').src = carouselImages[index];
  
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
  document.getElementById('lightboxImg').src = carouselImages[lightboxIndex];
  document.getElementById('lightboxCounter').innerText = `${lightboxIndex + 1} / ${carouselImages.length}`;
};

const setupLightboxSwipe = () => {
  const overlay = document.getElementById('lightboxOverlay');
  let startX = 0, diffX = 0;

  const onTouchStart = (e) => { startX = e.touches[0].clientX; };
  const onTouchMove = (e) => { diffX = e.touches[0].clientX - startX; };
  const onTouchEnd = () => {
    if (diffX < -50) { lightboxNav({ stopPropagation: () => {} }, 1); }
    else if (diffX > 50) { lightboxNav({ stopPropagation: () => {} }, -1); }
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
  if (e.key === 'ArrowLeft') lightboxNav({ stopPropagation: () => {} }, -1);
  if (e.key === 'ArrowRight') lightboxNav({ stopPropagation: () => {} }, 1);
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
    if (user.email?.toLowerCase() === CONFIG.adminEmail?.toLowerCase()) isAdmin = true;
  }

  // 2. Fetch Post UI Injection (with Retry)
  const post = await withRetry(() => fetchPost());

  // Inject visual data
  document.title = `${post.title} - HappyFood`;
  
  // Dynamic SEO Updates
  const metaTitle = document.getElementById('metaOgTitle');
  if (metaTitle) metaTitle.content = post.title;
  
  // Parse images (backward compatible with single URL or JSON array)
  const imageUrls = parseImageUrls(post.image_url);
  
  const metaImage = document.getElementById('metaOgImage');
  if (metaImage && imageUrls[0]) metaImage.content = imageUrls[0];

  // Setup image carousel
  setupCarousel(imageUrls);

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

  // Display content with clickable links
  const contentBox = document.getElementById("postContentBox");
  const rawContent = post.content || "No content provided.";
  contentBox.innerHTML = linkifyText(rawContent);

  // Show Admin Actions
  if (isAdmin) {
    document.getElementById("adminControls").classList.add("is-admin");
  }

  // 3. Init Interactions
  LikeService.fetchInitialState(currentUser.id);

  // 4. Init Comments (with Retry)
  const comments = await withRetry(() => CommentService.fetchAll());
  const nestedComments = buildCommentTree(comments);
  document.getElementById("commentList").innerHTML = renderCommentTreeHTML(nestedComments);

  // 5. Subscribe to Realtime Data
  RealtimeService.start();
};

document.addEventListener("DOMContentLoaded", initPostPage);

