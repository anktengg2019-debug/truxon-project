// Role-aware navigation for the sidebar. Additive only — it appends links to the
// existing `.nav-links` block so the original navigation/branding is preserved.

import { LOAD_POSTER_ROLES, BIDDER_ROLES } from './loads.js';

const LINKS = [
  { href: '/index.html', label: 'Live tracking', roles: null },
  { href: '/loads.html', label: 'Loads & bids', roles: null },
  { href: '/post-load.html', label: 'Post a load', roles: LOAD_POSTER_ROLES },
  { href: '/booking.html', label: 'Create booking', roles: LOAD_POSTER_ROLES },
  { href: '/wallet.html', label: 'Wallet', roles: null },
  { href: '/driver.html', label: 'Driver mode', roles: BIDDER_ROLES },
];

/**
 * Render the role-aware nav into the sidebar's `.nav-links` container.
 * @param {string} role current user's role (may be undefined)
 * @param {string} activePath e.g. '/loads.html'
 */
export function mountNav(role, activePath) {
  const container = document.querySelector('.nav-links');
  if (!container) return;
  container.innerHTML = '';
  LINKS.forEach((link) => {
    if (link.roles && !link.roles.includes(role)) return;
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.label;
    a.className = 'nav-link';
    if (link.href === activePath) a.classList.add('is-active');
    container.appendChild(a);
  });
}
