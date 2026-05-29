/**
 * Fetches from the API, forwarding the session cookie automatically
 * (same-origin request — CloudFront routes /api/* to API Gateway).
 *
 * @param {string} path  e.g. '/skills' or '/skills/my-slug'
 * @returns {Promise<any>} parsed JSON
 * @throws {Error} with status code on non-2xx response
 */
export async function fetchApi(path) {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/login?return_to=' + encodeURIComponent(window.location.pathname);
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}
