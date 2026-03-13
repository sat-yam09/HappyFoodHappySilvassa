/* ============================================================
   MANAGE ADS — Admin Panel Logic
   CRUD operations for the ad system via Supabase
   Requires: config.js (sb, CONFIG) + utils.js (showToast) loaded first.
   ============================================================ */

let currentUser = null;
let selectedFile = null;

/* === AUTH GUARD (uses sb + CONFIG from config.js) === */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  currentUser = session.user;

  if (!window.isAdminUser(currentUser)) {
    window.location.href = 'feed.html';
    return;
  }

  window.revealAdminUI(currentUser);

  // Load ads
  loadAds();
})();

/* Global logout handler */
window.handleLogout = async (e) => {
  if (e) e.preventDefault();
  await sb.auth.signOut();
  window.location.href = 'index.html';
};


/* === LOAD ALL ADS === */
async function loadAds() {
  const { data: ads, error } = await sb
    .from('ads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load ads', 'error');
    console.error(error);
    return;
  }

  renderAds(ads || []);
  updateStats(ads || []);
}


/* === RENDER AD LIST === */
function renderAds(ads) {
  const list = document.getElementById('adsList');
  const empty = document.getElementById('adsEmpty');

  if (ads.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  list.innerHTML = ads.map((ad, i) => {
    const isExpired = ad.ends_at && new Date(ad.ends_at) < new Date();
    const statusClass = isExpired ? 'expired' : (ad.is_active ? 'active' : 'inactive');
    const statusText = isExpired ? 'Expired' : (ad.is_active ? 'Active' : 'Paused');
    const isVideo = ad.media_type === 'video';

    const mediaEl = isVideo
      ? `<video class="ad-thumb-video" src="${ad.media_url}" muted preload="metadata"></video>`
      : `<img class="ad-thumb" src="${ad.media_url}" alt="${ad.title}" loading="lazy">`;

    return `
      <div class="ad-list-item" style="animation-delay: ${i * 0.05}s">
        ${mediaEl}
        <div class="ad-info">
          <div class="ad-info-title">${ad.title}</div>
          <div class="ad-info-business">${ad.business_name || 'No business name'}</div>
          <div class="ad-info-meta">
            <span>👆 ${ad.click_count || 0} clicks</span>
            <span>👁 ${ad.impression_count || 0} views</span>
            <span>📍 ${ad.placement || 'feed'}</span>
          </div>
        </div>
        <span class="ad-status-badge ${statusClass}">${statusText}</span>
        <div class="ad-actions">
          <button class="ad-action-btn" title="Edit" onclick="editAd('${ad.id}')">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
          </button>
          <button class="ad-action-btn" title="${ad.is_active ? 'Pause' : 'Activate'}" onclick="toggleAdStatus('${ad.id}', ${ad.is_active})">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${ad.is_active ? 'M10 9v6m4-6v6' : 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z'}"></path></svg>
          </button>
          <button class="ad-action-btn danger" title="Delete" onclick="deleteAd('${ad.id}')">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}


/* === UPDATE STATS === */
function updateStats(ads) {
  document.getElementById('totalAdsCount').textContent = ads.length;
  document.getElementById('activeAdsCount').textContent = ads.filter(a => a.is_active && (!a.ends_at || new Date(a.ends_at) > new Date())).length;
  document.getElementById('totalClicks').textContent = ads.reduce((sum, a) => sum + (a.click_count || 0), 0);
  document.getElementById('totalImpressions').textContent = ads.reduce((sum, a) => sum + (a.impression_count || 0), 0);
}


/* === MODAL CONTROLS === */
function showAdModal(editData = null) {
  const overlay = document.getElementById('adModalOverlay');
  const title = document.getElementById('adModalTitle');
  const form = document.getElementById('adForm');

  form.reset();
  selectedFile = null;
  document.getElementById('adUploadPreview').style.display = 'none';
  document.getElementById('adUploadPlaceholder').style.display = 'flex';
  document.getElementById('adEditId').value = '';

  if (editData) {
    title.textContent = 'Edit Ad';
    document.getElementById('adEditId').value = editData.id;
    document.getElementById('adTitle').value = editData.title || '';
    document.getElementById('adBusinessName').value = editData.business_name || '';
    document.getElementById('adDescription').value = editData.description || '';
    document.getElementById('adLinkUrl').value = editData.link_url || '';
    document.getElementById('adPlacement').value = editData.placement || 'both';
    if (editData.ends_at) {
      document.getElementById('adEndsAt').value = editData.ends_at.split('T')[0];
    }
    // Show existing media preview
    if (editData.media_url) {
      const preview = document.getElementById('adUploadPreview');
      const placeholder = document.getElementById('adUploadPlaceholder');
      if (editData.media_type === 'video') {
        preview.innerHTML = `<video src="${editData.media_url}" controls style="max-width:100%; max-height:180px; border-radius:12px;"></video>`;
      } else {
        preview.innerHTML = `<img src="${editData.media_url}" style="max-width:100%; max-height:180px; border-radius:12px;">`;
      }
      preview.style.display = 'block';
      placeholder.style.display = 'none';
    }
  } else {
    title.textContent = 'Create New Ad';
  }

  overlay.classList.add('active');
}

function hideAdModal() {
  document.getElementById('adModalOverlay').classList.remove('active');
}


/* === FILE INPUT HANDLER === */
document.getElementById('adFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  selectedFile = file;
  const preview = document.getElementById('adUploadPreview');
  const placeholder = document.getElementById('adUploadPlaceholder');

  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    preview.innerHTML = `<video src="${url}" controls muted style="max-width:100%; max-height:180px; border-radius:12px;"></video>`;
  } else {
    preview.innerHTML = `<img src="${url}" style="max-width:100%; max-height:180px; border-radius:12px;">`;
  }
  preview.style.display = 'block';
  placeholder.style.display = 'none';
});


/* === SUBMIT AD (CREATE or UPDATE) === */
async function handleAdSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('adSubmitBtn');
  btn.classList.add('loading');
  let uploadedPath = '';

  try {
    // Normalize the Link URL securely before database insertion
    let safeUrl = document.getElementById('adLinkUrl').value.trim();
    // Remove accidental quotes user might have pasted
    safeUrl = safeUrl.replace(/^["']|["']$/g, '').trim();
    
    if (safeUrl && !safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
      safeUrl = 'https://' + safeUrl;
    }

    const editId = document.getElementById('adEditId').value;
    const adData = {
      title: document.getElementById('adTitle').value,
      business_name: document.getElementById('adBusinessName').value,
      description: document.getElementById('adDescription').value,
      link_url: safeUrl,
      placement: document.getElementById('adPlacement').value,
      ends_at: document.getElementById('adEndsAt').value ? new Date(document.getElementById('adEndsAt').value).toISOString() : null,
    };

    // Upload new media if a file was selected
    if (selectedFile) {
      const ext = selectedFile.name.split('.').pop();
      const fileName = `ads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      uploadedPath = fileName;

      const { error: uploadError } = await sb.storage
        .from(CONFIG.storageBucket)
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = sb.storage
        .from(CONFIG.storageBucket)
        .getPublicUrl(fileName);

      adData.media_url = publicUrl;
      adData.media_type = selectedFile.type.startsWith('video/') ? 'video' : 'image';
    }

    if (editId) {
      // UPDATE
      const { error } = await sb.from('ads').update(adData).eq('id', editId);
      if (error) throw error;
      showToast('Ad updated successfully!', 'success');
    } else {
      // CREATE — media is required
      if (!selectedFile && !adData.media_url) {
        showToast('Please upload an image or video for the ad.', 'error');
        btn.classList.remove('loading');
        return;
      }
      adData.created_by = currentUser.id;
      adData.is_active = true;
      const { error } = await sb.from('ads').insert([adData]);
      if (error) throw error;
      showToast('Ad published successfully!', 'success');
    }

    hideAdModal();
    loadAds();
  } catch (err) {
    if (uploadedPath) {
      try {
        await sb.storage.from(CONFIG.storageBucket).remove([uploadedPath]);
      } catch (cleanupError) {
        console.warn('Failed to clean up ad upload after save error.', cleanupError);
      }
    }
    console.error(err);
    showToast(err.message || 'Something went wrong', 'error');
  } finally {
    btn.classList.remove('loading');
  }
}


/* === EDIT AD === */
async function editAd(adId) {
  const { data: ad, error } = await sb.from('ads').select('*').eq('id', adId).single();
  if (error || !ad) {
    showToast('Failed to load ad data', 'error');
    return;
  }
  showAdModal(ad);
}


/* === TOGGLE AD STATUS === */
async function toggleAdStatus(adId, currentActive) {
  const { data, error } = await sb.from('ads')
    .update({ is_active: !currentActive })
    .eq('id', adId)
    .select('id');
  if (error || !data?.length) {
    showToast('Failed to update status', 'error');
    return;
  }
  showToast(currentActive ? 'Ad paused' : 'Ad activated', 'success');
  loadAds();
}


/* === DELETE AD === */
async function deleteAd(adId) {
  if (!confirm('Are you sure you want to delete this ad? This cannot be undone.')) return;

  const { data, error } = await sb.from('ads').delete().eq('id', adId).select('id');
  if (error || !data?.length) {
    showToast('Failed to delete ad', 'error');
    return;
  }
  showToast('Ad deleted', 'success');
  loadAds();
}


/* === CLOSE MODAL ON OVERLAY CLICK === */
document.getElementById('adModalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideAdModal();
});

/* === CLOSE MODAL ON ESC === */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAdModal();
});
