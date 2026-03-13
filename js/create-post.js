/* ============================================================
   CREATE LOGIC — HappyFoodHappySilvassa
   Handles image preview, form validation, and Supabase publishing.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

/* === GLOBAL STATE === */
let currentUser = null;

// The Single Source of Truth for the current post draft
const PostDraft = {
  title: '',
  content: '',
  imageFiles: [],
  imagePreviewUrls: [],
  tags: [],
  publishAt: null, // For future scheduling
  status: 'draft'  // 'draft' | 'publishing' | 'published'
};

const IMAGE_LIMITS = {
  maxInputBytes: 20 * 1024 * 1024,
  maxOutputBytes: 350 * 1024,
  maxDimension: 1600,
  fallbackMaxDimension: 1200
};

/* === INITIALIZATION CORE (Admin Guard) === */
const initCreatePage = async () => {
  // 1. Session Guard
  await checkSession(null, 'index.html');

  // 2. Admin Check
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !window.isAdminUser(user)) {
    showToast("Access Denied: Admins only", 'error');
    window.location.href = 'feed.html';
    return;
  }
  currentUser = user;

  // 3. Restore Draft from Session Storage (Persistance)
  restoreDraft();

  // 4. Attach Listeners
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
    updateCounters(savedContent); // update live word count on load
  }
};

window.triggerFileSelect = (event) => {
  if (event) event.stopPropagation();
  document.getElementById('fileInput')?.click();
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
    updateCounters(PostDraft.content);
    saveDraft();
  });
};

const updateCounters = (text) => {
  const charCount = text.length;
  // Regex to split by whitespace robustly
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const wordCount = words.length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200)); // standard 200wpm

  document.getElementById('charCountLabel').innerText = `${charCount} characters`;
  document.getElementById('wordCountLabel').innerText = `${wordCount} words`;
  document.getElementById('readTimeLabel').innerText = `${readTime} min read`;
};


/* === TAGS INPUT SYSTEM === */
const setupTagsInput = () => {
  const input = document.getElementById('tagsInput');
  const wrapper = document.getElementById('tagsWrapper');

  const renderTags = () => {
    // Keep input field but clear existing chips
    Array.from(wrapper.querySelectorAll('.tag-chip')).forEach(c => c.remove());

    // Read tags array and output HTML
    PostDraft.tags.forEach((tag, index) => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        ${tag}
        <button type="button" class="tag-remove" onclick="removeTag(${index})" title="Remove">✕</button>
      `;
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
      // pop last tag if backspacing on empty input
      PostDraft.tags.pop();
      renderTags();
    }
  });

  // Export so clicking wrapper focuses input
  wrapper.addEventListener('click', () => input.focus());
};


/* === DRAG & DROP IMAGE LOGIC === */
const setupDragAndDrop = () => {
  const dropZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');

  // Clicks
  dropZone.addEventListener('click', () => fileInput.click());

  // Drag states
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

  // Drop capture
  dropZone.addEventListener('drop', (e) => {
    handleFiles(Array.from(e.dataTransfer.files || []));
  });

  // Manual Select
  fileInput.addEventListener('change', (e) => {
    handleFiles(Array.from(e.target.files || []));
    fileInput.value = '';
  });
};

const handleFiles = (files) => {
  files.forEach(handleFile);
};

const handleFile = (file) => {
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
  if (!validTypes.includes(file.type)) {
    showToast("Must be JPEG, PNG, WEBP or MP4/WEBM/MOV", 'error');
    return;
  }

  // Allow larger images through so we can compress them before upload.
  const maxSize = file.type.startsWith('video/') ? 50 * 1024 * 1024 : IMAGE_LIMITS.maxInputBytes;
  if (file.size > maxSize) {
    showToast(file.type.startsWith('video/') ? "Video must be under 50MB" : "Image must be under 20MB before compression", 'error');
    return;
  }

  if (PostDraft.imageFiles.length >= 10) {
    showToast("Maximum 10 photos or videos per post", 'error');
    return;
  }

  PostDraft.imageFiles.push(file);
  const previewUrl = URL.createObjectURL(file);
  PostDraft.imagePreviewUrls.push({ url: previewUrl, type: file.type });

  renderImageThumbnails();
};

const renderImageThumbnails = () => {
  const strip = document.getElementById('imageThumbsStrip');
  const addBtn = document.getElementById('addMoreBtn');

  // Clear existing thumbnails (keep addBtn)
  Array.from(strip.querySelectorAll('.thumb-item')).forEach(el => el.remove());

  PostDraft.imagePreviewUrls.forEach((media, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb-item';

    let mediaHtml = '';
    if (media.type.startsWith('video/')) {
      mediaHtml = `
        <video src="${media.url}" autoplay loop muted playsinline></video>
        <div class="thumb-type-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg></div>
      `;
    } else {
      mediaHtml = `<img src="${media.url}" alt="Photo ${index + 1}">`;
    }

    thumb.innerHTML = `
      ${mediaHtml}
      <button type="button" class="thumb-remove" onclick="removeImage(${index})" title="Remove">✕</button>
      <span class="thumb-badge">${index + 1}</span>
    `;
    strip.insertBefore(thumb, addBtn);
  });

  // Show/hide elements based on state
  if (PostDraft.imageFiles.length > 0) {
    document.getElementById('uploadZone').classList.add('has-images');
    document.querySelector('.upload-text').innerText = 'Add more photos or videos';
    addBtn.style.display = 'flex';
  } else {
    document.getElementById('uploadZone').classList.remove('has-images');
    document.querySelector('.upload-text').innerText = 'Drag photos or videos here or tap to select';
    addBtn.style.display = 'none';
  }

  document.getElementById('uploadZone').classList.remove('shake');
};

window.removeImage = (index) => {
  URL.revokeObjectURL(PostDraft.imagePreviewUrls[index].url);
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
    const prevHero = document.getElementById('prevHeroImage');
    const firstMedia = PostDraft.imagePreviewUrls[0];

    // Replace element entirely to handle img vs video tags cleanly
    const mediaElementWrapper = prevHero.parentElement;
    if (firstMedia && firstMedia.type.startsWith('video/')) {
      mediaElementWrapper.innerHTML = `<video id="prevHeroImage" src="${firstMedia.url}" autoplay loop muted playsinline></video>`;
    } else {
      mediaElementWrapper.innerHTML = `<img id="prevHeroImage" src="${firstMedia ? firstMedia.url : 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?auto=format&fit=crop&w=800'}" alt="Hero Background">`;
    }

    document.getElementById('prevTitle').innerText = PostDraft.title || 'Untitled Recipe';
    document.getElementById('prevDate').innerText = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('prevBody').innerText = PostDraft.content || 'Start designing your amazing post to see it here.';

    // Quick Tag injection
    const tagHtml = PostDraft.tags.map(t => `<span class="tag-chip">${t}</span>`).join('');
    document.getElementById('prevTags').innerHTML = tagHtml;

    editor.classList.add('hidden');
    preview.classList.add('active');
  } else {
    // Mode Editing
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
    if (!PostDraft.imageFiles.length) {
      document.getElementById('uploadZone').classList.add('shake');
      isValid = false;
    }

    if (!isValid) showToast("Please complete all required fields.", "error");
    return isValid;
  },

  async compressImage(file) {
    if (file.type.startsWith('video/')) return file; // Do not compress videos here

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleImage = (maxDimension) => {
          let width = img.width;
          let height = img.height;
          const longestSide = Math.max(width, height);

          if (longestSide > maxDimension) {
            const ratio = maxDimension / longestSide;
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        };

        const exportBlob = (quality) =>
          new Promise((blobResolve, blobReject) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                blobReject(new Error('Canvas to Blob failed'));
                return;
              }
              blobResolve(blob);
            }, 'image/webp', quality);
          });

        const buildBlob = async (maxDimension) => {
          scaleImage(maxDimension);
          let compressedBlob = await exportBlob(0.72);

          if (compressedBlob.size > IMAGE_LIMITS.maxOutputBytes) {
            compressedBlob = await exportBlob(0.58);
          }
          if (compressedBlob.size > IMAGE_LIMITS.maxOutputBytes) {
            compressedBlob = await exportBlob(0.48);
          }

          return compressedBlob;
        };

        (async () => {
          try {
            let blob = await buildBlob(IMAGE_LIMITS.maxDimension);
            if (blob.size > IMAGE_LIMITS.maxOutputBytes) {
              blob = await buildBlob(IMAGE_LIMITS.fallbackMaxDimension);
            }

            resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
              type: 'image/webp',
              lastModified: Date.now(),
            }));
          } catch (error) {
            reject(error);
          } finally {
            URL.revokeObjectURL(img.src);
          }
        })();
      };
      img.onerror = (e) => reject(e);
    });
  },

  async uploadMedia(file) {
    const isVideo = file.type.startsWith('video/');
    const finalFile = isVideo ? file : await this.compressImage(file);
    const cleanName = finalFile.name.replace(/[^a-zA-Z0-9.\-]/g, '');
    const uniquePath = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${cleanName}`;

    // Upload to 'images' bucket (Created in Day 1 SQL)
    const { data, error } = await sb.storage
      .from(CONFIG.storageBucket)
      .upload(uniquePath, finalFile, { cacheControl: '3600', upsert: false });

    if (error) throw error;

    // Retrieve public URL synchronously
    const { data: urlData } = sb.storage.from(CONFIG.storageBucket).getPublicUrl(uniquePath);
    // Explicitly return an object to distinguish videos from images later in rendering if needed,
    // though for now string URLs are handled mostly gracefully. Let's return the string URL,
    // but append a metadata flag via a custom structure if we needed deep backend integration.
    // Given the current architecture, simple strings work. The app infers type via extension (not perfectly)
    // or we can store an array of objects.
    // Changing standard storage to Objects: { url, type }
    return { url: urlData.publicUrl, type: finalFile.type, path: uniquePath };
  },

  async uploadAllImages() {
    const uploadedMedia = [];
    try {
      for (const file of PostDraft.imageFiles) {
        const result = await this.uploadMedia(file);
        uploadedMedia.push(result);
      }
      return uploadedMedia;
    } catch (error) {
      await this.cleanupUploadedMedia(uploadedMedia);
      throw error;
    }
  },

  async cleanupUploadedMedia(mediaArray) {
    const paths = mediaArray.map((media) => media.path).filter(Boolean);
    if (paths.length === 0) return;

    try {
      const { error } = await sb.storage.from(CONFIG.storageBucket).remove(paths);
      if (error) {
        console.warn('Failed to clean up uploaded media after publish error.', error);
      }
    } catch (cleanupError) {
      console.warn('Cleanup request failed after publish error.', cleanupError);
    }
  },

  async createPost(mediaArray) {
    // Always store as JSON string array for consistent parsing across feed.js and post.js
    const mediaValue = JSON.stringify(mediaArray.map(({ url, type }) => ({ url, type })));

    const payload = {
      title: PostDraft.title.trim(),
      content: PostDraft.content.trim(),
      image_url: mediaValue,
      user_id: currentUser.id,
      // Pass the tags array directly (Supabase JS auto-maps to TEXT[])
      tags: PostDraft.tags || []
    };

    // Scalability Handle: Inject future publish date if utilized
    if (PostDraft.publishAt) {
      payload.publish_at = new Date(PostDraft.publishAt).toISOString();
    }

    const { data, error } = await sb.from('posts').insert([payload]).select('*').single();
    if (error) throw error;
    return data;
  },

  async execute() {
    if (!this.validate()) return;

    // Safety Catch: Cannot double publish.
    if (PostDraft.status === 'publishing') return;
    PostDraft.status = 'publishing';

    // Show Overlay Wall (Disables interaction)
    document.getElementById('publishOverlay').classList.add('active');
    let uploadedMedia = [];

    try {
      // Step 1: Push binary to storage (Slowest)
      uploadedMedia = await this.uploadAllImages();

      // Step 2: Push row to database (Fast)
      const createdPost = await this.createPost(uploadedMedia);

      // Step 3: Success Flush
      if (createdPost) {
        sessionStorage.setItem('hfhs_recent_post', JSON.stringify({
          post: createdPost,
          expiresAt: Date.now() + (5 * 60 * 1000)
        }));
      }
      showToast("Post published to all feeds successfully!", "success");
      sessionStorage.removeItem('hfhs_draft_title');
      sessionStorage.removeItem('hfhs_draft_content');

      // Redirect
      setTimeout(() => window.location.href = 'feed.html', 1500);

    } catch (err) {
      await this.cleanupUploadedMedia(uploadedMedia);
      console.error(err);
      showToast(err.message || "Failed to publish. Try again.", "error");
      document.getElementById('publishOverlay').classList.remove('active');
      PostDraft.status = 'draft'; // Revert state so user can retry without losing text
    }
  }
};

window.handleInitiatePublish = () => PublishService.execute();
