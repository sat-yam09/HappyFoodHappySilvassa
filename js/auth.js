/* ============================================================
   AUTH — HappyFoodHappySilvassa
   Login/signup page logic. Only loaded on index.html.
   Requires: config.js + utils.js loaded first.
   ============================================================ */

// === TAB SWITCHING ===
const switchTab = (tab) => {
  const isLogin = tab === 'login';

  // Update tab button states
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabSignup').classList.toggle('active', !isLogin);

  // Slide the active indicator
  document.getElementById('tabIndicator').style.transform = isLogin ? 'translateX(0)' : 'translateX(100%)';

  // Toggle form visibility
  document.getElementById('loginForm').classList.toggle('active', isLogin);
  document.getElementById('signupForm').classList.toggle('active', !isLogin);
};
window.switchTab = switchTab;

// === SIGNUP HANDLER ===
const handleSignup = async () => {
  const name = document.getElementById('signupName').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;

  setButtonLoading('signupBtn', true);

  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name }
      }
    });

    if (error) throw error;

    showToast('Successfully registered! Please check your inbox to verify.', 'success');
    document.getElementById('signupForm').reset();

    // Switch to login tab after success
    setTimeout(() => switchTab('login'), 2000);
  } catch (err) {
    showToast(err.message || 'Error creating account. Please try again.', 'error');
  } finally {
    setButtonLoading('signupBtn', false);
  }
};
window.handleSignup = handleSignup;

// === LOGIN HANDLER ===
const handleLogin = async () => {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  setButtonLoading('loginBtn', true);

  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Block unverified users
    if (!data.user.email_confirmed_at) {
      await sb.auth.signOut();
      throw new Error('Please verify your email before logging in.');
    }

    showToast('Login successful! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = CONFIG.redirectAfterLogin;
    }, 1000);

  } catch (err) {
    showToast(err.message || 'Login failed.', 'error');
  } finally {
    setButtonLoading('loginBtn', false);
  }
};
window.handleLogin = handleLogin;

// === GOOGLE LOGIN HANDLER ===
window.handleGoogleLogin = async () => {
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/' + CONFIG.redirectAfterLogin
      }
    });
    if (error) throw error;
  } catch (err) {
    showToast(err.message || 'Google login failed.', 'error');
  }
};

// === PAGE INITIALIZATION ===
const init = async () => {
  // If user already has a session, redirect to feed
  await checkSession(CONFIG.redirectAfterLogin, null);
};

document.addEventListener('DOMContentLoaded', init);
