/* ============================================================
   CONFIG — HappyFoodHappySilvassa
   Central configuration object and Supabase client init.
   Include this file on EVERY page BEFORE utils.js and page scripts.
   ============================================================ */

const CONFIG_VERSION = '4'; // Bump this when env shape changes
const IS_LOCAL_DEV = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
let envConfig = {};
try {
  let cachedVersion = window.sessionStorage.getItem('__HFHS_ENV_V');
  let cached = window.sessionStorage.getItem('__HFHS_ENV');

  if (cached && cachedVersion === CONFIG_VERSION) {
    envConfig = JSON.parse(cached);
  } else if (!IS_LOCAL_DEV) {
    // Clear stale cache
    window.sessionStorage.removeItem('__HFHS_ENV');
    // Using synchronous XHR to block execution until config loads.
    let xhr = new XMLHttpRequest();
    // Wrap in try catch specifically for the 404 since it's expected on local servers
    try {
      xhr.open('GET', '/api/config', false);
      xhr.send();
      if (xhr.status === 200) {
        envConfig = JSON.parse(xhr.responseText);
        window.sessionStorage.setItem('__HFHS_ENV', xhr.responseText);
        window.sessionStorage.setItem('__HFHS_ENV_V', CONFIG_VERSION);
      }
    } catch (e) {
      // Local development will intentionally fail this synchronous ping, gracefully fall through
    }
  }
} catch (e) {
  // Silent fallback to local config, suppressing Vercel env extraction errors in dev
}

const CONFIG = {
  // Use Vercel injects, fallback to existing for local dev outside Vercel
  supabaseUrl: envConfig.SUPABASE_URL || 'https://fvogbzausgaktwmaurmw.supabase.co',
  supabaseKey: envConfig.SUPABASE_ANON_KEY || 'sb_publishable_14nVwF5ZaJk_gnHIN9Ls3g_ajFzWwy9',
  adminEmail: envConfig.ADMIN_EMAIL || 'buildwithdevian@gmail.com',
  storageBucket: envConfig.STORAGE_BUCKET || 'images',
  appName: 'HappyFoodHappySilvassa',
  redirectAfterLogin: 'feed.html'
};

// Initialize Supabase client (available globally as `sb`)
const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
