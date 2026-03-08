/* ============================================================
   CREATE LOGIC — HappyFoodHappySilvassa
   Handles multi-image upload, form validation, and publishing.
   Simple flow: Multiple Images + Title + Tags + Caption.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

/* === GLOBAL STATE === */
let currentUser = null;

// The Single Source of Truth for the current post draft
const PostDraft = {
  title: '',
  content: '',
  imageFiles: [],       // Array of File objects
  imagePreviewUrls: [], // Array of blob URLs for preview
  tags: [],
  publishAt: null,
  status: 'draft'
};

/* === INITIALIZATION CORE (Admin Guard) === */
const initCreatePage = async () => {
  await checkSession(null, 'index.html');
  
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.email?.toLowerCase() !== CONFIG.adminEmail?.toLowerCase()) {
    showToast("Access Denied: Admins only", 'error');
    window.location.href = 'feed.html';
    return;
  }
  currentUser = user;

  restoreDraft();
  setupFormListeners();
  setupDragAndDrop();
  setupTagsInput();
};
document.addEventListener('DOMContentLoaded', initCreatePage);

/* === DRAFT PERSISTENCE === */
const saveDraft = () => {
  sessionStorage.setItem('hfhs_draft_title', PostDraft.title);
  sessionStorage.setItem('hfhs_draft_content', PostDraft.content);
};

const restoreDraft = () => {
  const savedTitle = sessionStorage.getItem('hfhs_draft_title');
  const savedContent = sessionStorage.getItem('hfhs_draft_content');
  
  if (savedTitle) {
    PostDraft.title = savedTitle;
    document.getElementById('postTitleInput').value = savedTitle;
  }
  if (savedContent) {
    PostDraft.content = savedContent;
    document.getElementById('postContentInput').value = savedContent;
    updateCounters(savedContent);
  }
};

/* === FORM LISTENERS === */
const setupFormListeners = () => {
  const titleInput = document.getElementById('postTitleInput');
  const contentInput = document.getElementById('postContentInput');

  titleInput.addEventListener('input', (e) => {
    PostDraft.title = e.target.value;
    titleInput.classList.remove('shake');
    saveDraft();
  });

  contentInput.addEventListener('input', (e) => {
    PostDraft.content = e.target.value;
    contentInput.classList.remove('shake');
    updateCounters(e.target.value);
    saveDraft();
  });
};

const updateCounters = (text) => {
  const charCount = text.length;
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const wordCount = words.length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  document.getElementById('charCountLabel').innerText = `${charCount} characters`;
  document.getElementById('wordCountLabel').innerText = `${wordCount} words`;
  document.getElementById('readTimeLabel').innerText = `${readTime} min read`;
};


/* === TAGS INPUT SYSTEM === */
const setupTagsInput = () => {
  const input = document.getElementById('tagsInput');
  const wrapper = document.getElementById('tagsWrapper');

  const renderTags = () => {
    Array.from(wrapper.querySelectorAll('.tag-chip')).forEach(c => c.remove());
    PostDraft.tags.forEach((tag, index) => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `${tag} <button type="button" class="tag-remove" onclick="removeTag(${index})" title="Remove">✕</button>`;
      wrapper.insertBefore(chip, input);
    });
  };

  window.removeTag = (index) => {
    PostDraft.tags.splice(index, 1);
    renderTags();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,/g, '');
      if (val && !PostDraft.tags.includes(val)) {
        PostDraft.tags.push(val);
        input.value = '';
        renderTags();
      }
    } else if (e.key === 'Backspace' && input.value === '' && PostDraft.tags.length > 0) {
      PostDraft.tags.pop();
      renderTags();
    }
  });

  wrapper.addEventListener('click', () => input.focus());
};


/* === MULTI-IMAGE DRAG & DROP === */
const setupDragAndDrop = () => {
  const dropZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => handleFile(f));
  });

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(f => handleFile(f));
    fileInput.value = ''; // Reset so same file can be re-selected
  });
};

const handleFile = (file) => {
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast("Must be JPEG, PNG, or WEBP", 'error');
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image must be smaller than 5MB", 'error');
    return;
  }

  if (PostDraft.imageFiles.length >= 10) {
    showToast("Maximum 10 images per post", 'error');
    return;
  }

  PostDraft.imageFiles.push(file);
  const previewUrl = URL.createObjectURL(file);
  PostDraft.imagePreviewUrls.push(previewUrl);

  renderImageThumbnails();
};

const renderImageThumbnails = () => {
  const strip = document.getElementById('imageThumbsStrip');
  const addBtn = document.getElementById('addMoreBtn');
  
  // Clear existing thumbnails (keep addBtn)
  Array.from(strip.querySelectorAll('.thumb-item')).forEach(el => el.remove());

  PostDraft.imagePreviewUrls.forEach((url, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb-item';
    thumb.innerHTML = `
      <img src="${url}" alt="Photo ${index + 1}">
      <button type="button" class="thumb-remove" onclick="removeImage(${index})" title="Remove">✕</button>
      <span class="thumb-badge">${index + 1}</span>
    `;
    strip.insertBefore(thumb, addBtn);
  });

  // Show/hide elements based on state
  if (PostDraft.imageFiles.length > 0) {
    document.getElementById('uploadZone').classList.add('has-images');
    addBtn.style.display = 'flex';
  } else {
    document.getElementById('uploadZone').classList.remove('has-images');
    addBtn.style.display = 'none';
  }

  document.getElementById('uploadZone').classList.remove('shake');
};

window.removeImage = (index) => {
  URL.revokeObjectURL(PostDraft.imagePreviewUrls[index]);
  PostDraft.imageFiles.splice(index, 1);
  PostDraft.imagePreviewUrls.splice(index, 1);
  renderImageThumbnails();
};


/* === PREVIEW MODE TOGGLE === */
window.toggleMode = (mode) => {
  document.getElementById('editToggleBtn').classList.toggle('active', mode === 'edit');
  document.getElementById('previewToggleBtn').classList.toggle('active', mode === 'preview');

  const editor = document.getElementById('editorContainer');
  const preview = document.getElementById('previewContainer');

  if (mode === 'preview') {
    document.getElementById('prevHeroImage').src = PostDraft.imagePreviewUrls[0] || 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?auto=format&fit=crop&w=800';
    document.getElementById('prevTitle').innerText = PostDraft.title || 'Untitled Recipe';
    document.getElementById('prevDate').innerText = new Date().toLocaleDateString('en-US', { year:'numeric', month: 'long', day: 'numeric' });
    document.getElementById('prevBody').innerText = PostDraft.content || 'Start designing your amazing post to see it here.';
    
    const tagHtml = PostDraft.tags.map(t => `<span class="tag-chip">${t}</span>`).join('');
    document.getElementById('prevTags').innerHTML = tagHtml;

    editor.classList.add('hidden');
    preview.classList.add('active');
  } else {
    editor.classList.remove('hidden');
    preview.classList.remove('active');
  }
};


/* === PUBLISH FLOW === */
const PublishService = {

  validate() {
    let isValid = true;
    
    if (!PostDraft.title.trim()) {
      document.getElementById('postTitleInput').classList.add('shake');
      isValid = false;
    }
    if (!PostDraft.content.trim()) {
      document.getElementById('postContentInput').classList.add('shake');
      isValid = false;
    }
    if (PostDraft.imageFiles.length === 0) {
      document.getElementById('uploadZone').classList.add('shake');
      isValid = false;
    }

    if (!isValid) showToast("Please complete all required fields.", "error");
    return isValid;
  },

  async uploadImage(file) {
    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-]/g, '');
    const uniquePath = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${cleanName}`;

    const { data, error } = await sb.storage
      .from('images')
      .upload(uniquePath, file, { cacheControl: '3600', upsert: false });

    if (error) throw error;

    const { data: urlData } = sb.storage.from('images').getPublicUrl(uniquePath);
    return urlData.publicUrl;
  },

  async uploadAllImages() {
    const urls = [];
    for (const file of PostDraft.imageFiles) {
      const url = await this.uploadImage(file);
      urls.push(url);
    }
    return urls;
  },

  async createPost(imageUrls) {
    // Store as JSON array string for multiple images, backward compatible
    const imageUrlValue = imageUrls.length === 1 ? imageUrls[0] : JSON.stringify(imageUrls);
    
    const payload = {
      title: PostDraft.title.trim(),
      content: PostDraft.content.trim(),
      image_url: imageUrlValue,
      user_id: currentUser.id,
      tags: PostDraft.tags || []
    };

    if (PostDraft.publishAt) {
      payload.publish_at = new Date(PostDraft.publishAt).toISOString();
    }

    const { error } = await sb.from('posts').insert([payload]);
    if (error) throw error;
  },

  async execute() {
    if (!this.validate()) return;
    
    if (PostDraft.status === 'publishing') return;
    PostDraft.status = 'publishing';

    document.getElementById('publishOverlay').classList.add('active');

    try {
      // Step 1: Upload all images
      const finalUrls = await this.uploadAllImages();
      
      // Step 2: Create post row
      await this.createPost(finalUrls);

      // Step 3: Success
      showToast("Post published to all feeds successfully!", "success");
      sessionStorage.removeItem('hfhs_draft_title');
      sessionStorage.removeItem('hfhs_draft_content');
      
      setTimeout(() => window.location.href = 'feed.html', 1500);

    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to publish. Try again.", "error");
      document.getElementById('publishOverlay').classList.remove('active');
      PostDraft.status = 'draft';
    }
  }
};

window.handleInitiatePublish = () => PublishService.execute();
