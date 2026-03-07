/* ============================================================
   UTILS — HappyFoodHappySilvassa
   Shared utility functions used across ALL pages.
   Requires: config.js loaded first (for `sb` and `CONFIG`).
   ============================================================ */

// === TOAST NOTIFICATION SYSTEM ===
// Usage: showToast('Hello!', 'success')  |  'error'  |  'info'
const showToast = (message, type = 'info') => {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Icon based on type
  let icon = '';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '⚠';
  if (type === 'info') icon = 'ℹ';

  toast.innerHTML = `<span style="font-weight: bold;">${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  // Trigger slide-in animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Auto dismiss after 3 seconds
  setTimeout(() => {
    toast.classList.replace('show', 'hide');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

// === BUTTON LOADING STATE ===
// Usage: setButtonLoading('loginBtn', true)
const setButtonLoading = (btnId, isLoading) => {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  if (isLoading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
};

// === SESSION GUARD UTILITY ===
// Reusable on every page to protect routes.
// Usage: checkSession('feed.html', null)   → redirect if logged in
// Usage: checkSession(null, 'index.html')  → redirect if NOT logged in
const checkSession = async (redirectIfFound, redirectIfNone) => {
  try {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw error;

    if (session && redirectIfFound) {
      window.location.href = redirectIfFound;
    } else if (!session && redirectIfNone) {
      window.location.href = redirectIfNone;
    }
  } catch (err) {
    console.error('Session check error:', err);
  }
};

// === PASSWORD TOGGLE ===
// Usage: togglePassword('loginPassword')
const togglePassword = (inputId) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
};

// === CUSTOM CONFIRMATION MODAL ===
// Usage: showConfirmModal({ title: 'Delete?', text: '...', onConfirm: () => {} })
const showConfirmModal = ({ title = 'Are you sure?', text, confirmText = 'Delete', type = 'danger', onConfirm }) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  overlay.innerHTML = `
    <div class="modal-content">
      <h3 class="modal-title">${title}</h3>
      <p class="modal-text">${text}</p>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel">Cancel</button>
        <button class="modal-btn modal-btn-confirm" style="${type === 'danger' ? '' : 'background: var(--color-pink); box-shadow: 0 4px 15px rgba(237, 69, 147, 0.3);'}">
          ${confirmText}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Slide in
  setTimeout(() => overlay.classList.add('show'), 10);
  
  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 300);
  };
  
  overlay.querySelector('.modal-btn-cancel').onclick = close;
  overlay.querySelector('.modal-btn-confirm').onclick = () => {
    if (onConfirm) onConfirm();
    close();
  };
  
  // Close on outside click
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
};

/* ============================================================
   DAY 7: NETWORK RESILIENCE & ERROR BOUNDARIES
   ============================================================ */

// 1. GLOBAL ERROR HANDLER
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  showToast('Something went wrong. Please try again.', 'error');
});

// 2. NETWORK STATUS DETECTION
window.addEventListener('offline', () => {
  showToast('You are offline — changes may not save.', 'error');
});
window.addEventListener('online', () => {
  showToast('Back online!', 'success');
});

// 3. SUPABASE CONNECTION RETRY WRAPPER
// Usage: const data = await withRetry(() => PostService.fetchAll(state));
async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      console.warn(`Attempt ${attempt} failed. Retrying in ${delayMs * attempt}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

// 4. CLEANUP SUPABASE CHANNELS ON UNLOAD
window.addEventListener('beforeunload', () => {
  if (typeof sb !== 'undefined' && sb.removeAllChannels) {
    sb.removeAllChannels();
  }
});

// 5. GLOBAL REALTIME DISCONNECT INDICATOR
window.showRealtimeDisconnectDot = () => {
  if (document.getElementById('rt-status-dot')) return;
  const dot = document.createElement('div');
  dot.id = 'rt-status-dot';
  dot.innerHTML = '🟡';
  dot.title = 'Realtime Disconnected';
  dot.style.cssText = 'position:fixed; top:20px; right:20px; font-size:12px; z-index:9999; filter:drop-shadow(0 0 5px orange);';
  document.body.appendChild(dot);
};

// 6. SERVICE WORKER REGISTRATION (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}
