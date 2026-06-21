// Renders the signed-in user's identity + a logout button in the sidebar.
import { getCurrentProfile, logout } from './auth.js';

export async function mountUserBar(user) {
  const bar = document.getElementById('user-bar');
  if (!bar) return;
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const logoutBtn = document.getElementById('logout-btn');

  let profile = null;
  try {
    profile = await getCurrentProfile();
  } catch {
    // Reading the profile is best-effort for display.
  }
  nameEl.textContent = profile?.name || user.email || 'Signed in';
  roleEl.textContent = profile?.role ? profile.role : '';
  bar.hidden = false;

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    try {
      await logout();
    } finally {
      location.replace('/login.html');
    }
  });
}
