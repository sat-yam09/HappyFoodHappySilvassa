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
  imageFile: null,
  imagePreviewUrl: '',
  tags: [],
  publishAt: null, // For future scheduling
  status: 'draft'  // 'draft' | 'publishing' | 'published'
};

let quill;

/* === INITIALIZATION CORE (Admin Guard) === */
const initCreatePage = async () => {
  // 1. Session Guard
  await checkSession(null, 'index.html');
  
  // 2. Admin Check
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.email?.toLowerCase() !== CONFIG.adminEmail?.toLowerCase()) {
    showToast("Access Denied: Admins only", 'error');
    window.location.href = 'feed.html';
    return;
  }
  currentUser = user;

  // 3. Initialize Quill Editor
  quill = new Quill('#quillEditor', {
    theme: 'snow',
    placeholder: 'Write the story behind the dish, ingredients, and steps here...',
    modules: {
      toolbar: [
        [{ 'header': [2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        ['link', 'clean']
      ]
    }
  });

  // 4. Restore Draft from Session Storage (Persistance)
  restoreDraft();

  // 5. Attach Listeners
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
    // Load saved HTML into Quill
    quill.root.innerHTML = savedContent;
    updateCounters(quill.getText()); // Use plain text for counting
  }
};

/* === FORM LISTENERS === */
const setupFormListeners = () => {
  const titleInput = document.getElementById('postTitleInput');

  titleInput.addEventListener('input', (e) => {
    PostDraft.title = e.target.value;
    titleInput.classList.remove('shake');
    saveDraft();
  });

  // Listen to Quill changes
  quill.on('text-change', () => {
    // Get HTML content for saving/publishing
    const htmlContent = quill.root.innerHTML;
    // If it's effectively empty (Quill default empty state), clear it
    if (quill.getText().trim() === '') {
      PostDraft.content = '';
    } else {
      PostDraft.content = htmlContent;
    }
    
    // Update counters using plain text
    updateCounters(quill.getText());
    saveDraft();
    
    // remove shake class from wrapper if it exists
    document.getElementById('editorWrapper').classList.remove('shake');
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
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });

  // Manual Select
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleFile(file);
  });
};

const handleFile = (file) => {
  if (!file) return;

  // Validation
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast("Must be JPEG, PNG, or WEBP", 'error');
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) { // 5MB limit
    showToast("Image must be smaller than 5MB", 'error');
    return;
  }
  
  if (file.size > 1 * 1024 * 1024) { // 1MB warning (Scalability Note)
    showToast("Large image — consider compressing for faster feed loads.", 'info');
  }

  // Set Draft State
  PostDraft.imageFile = file;
  
  // Create object URL for local preview (avoids unnecessary remote upload during draft)
  if (PostDraft.imagePreviewUrl) URL.revokeObjectURL(PostDraft.imagePreviewUrl);
  PostDraft.imagePreviewUrl = URL.createObjectURL(file);

  // Update UI
  document.getElementById('uploadZone').classList.remove('shake');
  document.getElementById('uploadTextContainer').style.display = 'none';
  
  const previewContainer = document.getElementById('imagePreviewContainer');
  previewContainer.classList.add('active');
  document.getElementById('previewImg').src = PostDraft.imagePreviewUrl;
};

// Also exported so "Change Photo" button can override click propagation
window.triggerFileSelect = (e) => {
  e.stopPropagation();
  document.getElementById('fileInput').click();
};


/* === PREVIEW MODE TOGGLE === */
window.toggleMode = (mode) => {
  document.getElementById('editToggleBtn').classList.toggle('active', mode === 'edit');
  document.getElementById('previewToggleBtn').classList.toggle('active', mode === 'preview');

  const editor = document.getElementById('editorContainer');
  const preview = document.getElementById('previewContainer');

  if (mode === 'preview') {
    // Inject Editor Data into Preview Scaffold
    document.getElementById('prevHeroImage').src = PostDraft.imagePreviewUrl || 'https://images.unsplash.com/photo-1495195134817-a165bd39e4e3?auto=format&fit=crop&w=800';
    document.getElementById('prevTitle').innerText = PostDraft.title || 'Untitled Recipe';
    document.getElementById('prevDate').innerText = new Date().toLocaleDateString('en-US', { year:'numeric', month: 'long', day: 'numeric' });
    document.getElementById('prevBody').innerHTML = PostDraft.content || 'Start designing your amazing post to see it here.';
    
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
    // Quill is never truly "empty" if someone types a space, but we cleared in the listener
    if (!PostDraft.content.trim()) {
      document.getElementById('editorWrapper').classList.add('shake');
      isValid = false;
    }
    if (!PostDraft.imageFile) {
      document.getElementById('uploadZone').classList.add('shake');
      isValid = false;
    }

    if (!isValid) showToast("Please complete all required fields.", "error");
    return isValid;
  },

  async uploadImage(file) {
    // Build unique clean filename
    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-]/g, '');
    const uniquePath = `${Date.now()}-${cleanName}`;

    // Upload to 'images' bucket (Created in Day 1 SQL)
    const { data, error } = await sb.storage
      .from('images')
      .upload(uniquePath, file, { cacheControl: '3600', upsert: false });

    if (error) throw error;

    // Retrieve public URL synchronously
    const { data: urlData } = sb.storage.from('images').getPublicUrl(uniquePath);
    return urlData.publicUrl;
  },

  async createPost(imageUrl) {
    const payload = {
      title: PostDraft.title.trim(),
      content: PostDraft.content.trim(),
      image_url: imageUrl,
      user_id: currentUser.id,
      // Pass the tags array directly (Supabase JS auto-maps to TEXT[])
      tags: PostDraft.tags || []
    };

    // Scalability Handle: Inject future publish date if utilized
    if (PostDraft.publishAt) {
      payload.publish_at = new Date(PostDraft.publishAt).toISOString();
    }

    const { error } = await sb.from('posts').insert([payload]);
    if (error) throw error;
  },

  async execute() {
    if (!this.validate()) return;
    
    // Safety Catch: Cannot double publish.
    if (PostDraft.status === 'publishing') return;
    PostDraft.status = 'publishing';

    // Show Overlay Wall (Disables interaction)
    document.getElementById('publishOverlay').classList.add('active');

    try {
      // Step 1: Push binary to storage (Slowest)
      const finalUrl = await this.uploadImage(PostDraft.imageFile);
      
      // Step 2: Push row to database (Fast)
      await this.createPost(finalUrl);

      // Step 3: Success Flush
      showToast("Post published to all feeds successfully!", "success");
      sessionStorage.removeItem('hfhs_draft_title');
      sessionStorage.removeItem('hfhs_draft_content');
      
      // Redirect
      setTimeout(() => window.location.href = 'feed.html', 1500);

    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to publish. Try again.", "error");
      document.getElementById('publishOverlay').classList.remove('active');
      PostDraft.status = 'draft'; // Revert state so user can retry without losing text
    }
  }
};

window.handleInitiatePublish = () => PublishService.execute();
