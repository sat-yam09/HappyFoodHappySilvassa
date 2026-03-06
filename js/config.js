/* ============================================================
   CONFIG — HappyFoodHappySilvassa
   Central configuration object and Supabase client init.
   Include this file on EVERY page BEFORE utils.js and page scripts.
   ============================================================ */

let envConfig = {};
try {
  let cached = window.sessionStorage.getItem('__HFHS_ENV');
  if (cached) {
    envConfig = JSON.parse(cached);
  } else {
    // Using synchronous XHR to block execution until config loads.
    // This allows existing sync code to work without a massive async refactoring.
    let xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/config', false); 
    xhr.send();
    if (xhr.status === 200) {
      envConfig = JSON.parse(xhr.responseText);
      window.sessionStorage.setItem('__HFHS_ENV', xhr.responseText);
    }
  }
} catch (e) {
  console.error('Failed to load Vercel env variables:', e);
}

const CONFIG = {
  // Use Vercel injects, fallback to existing for local dev outside Vercel
  supabaseUrl: envConfig.SUPABASE_URL || 'https://fvogbzausgaktwmaurmw.supabase.co',
  supabaseKey: envConfig.SUPABASE_ANON_KEY || 'sb_publishable_14nVwF5ZaJk_gnHIN9Ls3g_ajFzWwy9',
  adminEmail: 'satyamchoudharyfreefree@gmail.com',
  adminPassword: 'S@tyam_0902',
  appName: 'HappyFoodHappySilvassa',
  redirectAfterLogin: 'feed.html'
};

// Initialize Supabase client (available globally as `sb`)
const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
