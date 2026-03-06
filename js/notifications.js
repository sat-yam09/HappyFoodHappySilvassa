/* ============================================================
   NOTIFICATIONS LOGIC — HappyFoodHappySilvassa
   Requires: config.js + utils.js loaded first.
   ============================================================ */

const initNotifs = async () => {
  // 1. Session Guard - Admins Only
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.email !== CONFIG.adminEmail) {
    showToast("Access Denied: Admins only", 'error');
    window.location.href = 'feed.html';
    return;
  }

  // 2. Fetch Data
  await renderList();
};

const renderList = async () => {
  const container = document.getElementById('notifList');
  
  try {
    const { data, error } = await withRetry(() => sb.from('admin_notifications').select('*').limit(50));
    
    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="notif-empty">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
          <h3>All caught up!</h3>
          <p>When people interact with your recipes, you'll see it here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(item => {
      let text, icon, colorClass;
      
      if (item.type === 'comment') {
        text = `<b>${item.user_name || 'Someone'}</b> commented on <i>"${item.post_title}"</i>`;
        icon = '💬';
        colorClass = 'comment';
      } else {
        text = `<b>${item.user_name || 'Someone'}</b> liked your post <i>"${item.post_title}"</i>`;
        icon = '❤️';
        colorClass = 'like';
      }

      const dateStr = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute:'2-digit' }).format(new Date(item.created_at));

      return `
        <a href="post.html?id=${item.post_id}" class="notif-card">
          <div class="notif-icon ${colorClass}">${icon}</div>
          <div class="notif-content">
            <p class="notif-text">${text}</p>
            <span class="notif-time">${dateStr}</span>
          </div>
        </a>
      `;
    }).join('');

  } catch (err) {
    console.error("Failed to load notifications:", err);
    showToast("Failed to load activity.", 'error');
  }
};

document.addEventListener('DOMContentLoaded', initNotifs);
