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

    try {
      // Send to Supabase
      const { error } = await sb.from("comments").insert([
        {
          post_id: currentPostId,
          user_id: currentUser.id,
          user_name: optimisticComment.user_name,
          content: content,
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
        <span class="comment-author">${c.user_name || "Anonymous"}</span>
        <span class="comment-date">${dateStr}</span>
        ${delBtn}
      </div>
      <div class="comment-text">${c.content}</div>
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
  document.getElementById("heroImage").src =
    post.image_url ||
    "https://images.unsplash.com/photo-1495195134817-a165bd39e4e3";
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
  document.getElementById("postContentBox").innerHTML =
    post.content || "<p>No content provided.</p>";

  // Show Admin Actions
  if (isAdmin) {
    document.getElementById("adminControls").classList.add("is-admin");
  }

  // 3. Init Interactions
  LikeService.fetchInitialState(currentUser.id);

  // 4. Init Comments (with Retry)
  const comments = await withRetry(() => CommentService.fetchAll());
  document.getElementById("commentList").innerHTML = comments
    .map((c) => renderCommentHTML(c))
    .join("");

  // 5. Subscribe to Realtime Data
  RealtimeService.start();
};

document.addEventListener("DOMContentLoaded", initPostPage);
