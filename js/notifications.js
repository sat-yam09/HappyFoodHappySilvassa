/* ============================================================
   NOTIFICATIONS LOGIC - HappyFoodHappySilvassa
   Requires: config.js + utils.js loaded first.
   ============================================================ */

const createNotificationsEmptyState = () => {
  const wrapper = document.createElement('div');
  wrapper.className = 'notif-empty';

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('d', 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9');
  icon.appendChild(path);

  const title = document.createElement('h3');
  title.textContent = 'All caught up!';

  const copy = document.createElement('p');
  copy.textContent = "When people interact with your recipes, you'll see it here.";

  wrapper.append(icon, title, copy);
  return wrapper;
};

const createNotificationCard = (item) => {
  const card = document.createElement('a');
  card.className = 'notif-card';
  card.href = `post.html?id=${encodeURIComponent(item.post_id)}`;

  const iconWrap = document.createElement('div');
  iconWrap.className = `notif-icon ${item.type === 'comment' ? 'comment' : 'like'}`;
  iconWrap.textContent = item.type === 'comment' ? '💬' : '❤️';

  const content = document.createElement('div');
  content.className = 'notif-content';

  const text = document.createElement('p');
  text.className = 'notif-text';

  const actor = document.createElement('b');
  actor.textContent = item.user_name || 'Someone';

  const postTitle = document.createElement('i');
  postTitle.textContent = `"${item.post_title || 'Untitled Recipe'}"`;

  if (item.type === 'comment') {
    text.append(actor, document.createTextNode(' commented on '), postTitle);
  } else {
    text.append(actor, document.createTextNode(' liked your post '), postTitle);
  }

  const time = document.createElement('span');
  time.className = 'notif-time';
  time.textContent = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(item.created_at));

  content.append(text, time);
  card.append(iconWrap, content);
  return card;
};

const renderList = async () => {
  const container = document.getElementById('notifList');

  try {
    const { data, error } = await withRetry(() =>
      sb.from('admin_notifications').select('*').order('created_at', { ascending: false }).limit(50)
    );

    if (error) throw error;

    if (!data || data.length === 0) {
      container.replaceChildren(createNotificationsEmptyState());
      return;
    }

    const fragment = document.createDocumentFragment();
    data.forEach((item) => {
      fragment.appendChild(createNotificationCard(item));
    });
    container.replaceChildren(fragment);
  } catch (err) {
    console.error('Failed to load notifications:', err);
    showToast('Failed to load activity.', 'error');
  }
};

const initNotifs = async () => {
  await checkSession(null, 'index.html');

  const { data: { user } } = await sb.auth.getUser();
  if (!user || !window.isAdminUser(user)) {
    showToast('Access Denied: Admins only', 'error');
    window.location.href = 'feed.html';
    return;
  }

  window.revealAdminUI(user);
  await renderList();
};

window.handleLogout = async (e) => {
  if (e) e.preventDefault();
  await sb.auth.signOut();
  window.location.href = 'index.html';
};

document.addEventListener('DOMContentLoaded', initNotifs);
