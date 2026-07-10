/**
 * Fire-and-forget behavioral analytics.
 *
 * Sends { event, props } to POST /api/events. Identity (user_email) and the
 * authoritative timestamp are stamped server-side from the JWT — the client
 * never supplies them. Must never throw or block navigation: a dropped event
 * is acceptable, a broken page is not.
 */
export function track(event, props = {}) {
  try {
    const body = JSON.stringify({ event, props });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/events', blob)) return;
    }
    // Fallback: keepalive fetch survives page unload for terminal events.
    fetch('/api/events', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  } catch {
    // analytics failures are silent by design
  }
}

/**
 * Classify how the user reached a detail page, for skill_view.referrer.
 * Same-origin referrer → 'browse'; anything else (or none) → 'direct'.
 * (A dedicated 'search' source would require search-result links to carry a
 * marker; deferred — see plan.)
 */
export function referrerSource() {
  try {
    const ref = document.referrer;
    if (!ref) return 'direct';
    return new URL(ref).origin === window.location.origin ? 'browse' : 'direct';
  } catch {
    return 'direct';
  }
}

/** Fire a page_view for the current location. */
export function trackPageView() {
  track('page_view', {
    path: window.location.pathname,
    referrer: document.referrer || '',
  });
}

/** Trailing debounce — fire fn once after `ms` of quiet. */
export function debounce(fn, ms = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
