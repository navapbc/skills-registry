// CloudFront Function (cloudfront-js-2.0 runtime)
// Validates the __session JWT cookie before serving any content.
// Template variables injected by Terraform: jwt_secret, login_path

import crypto from 'crypto';

const JWT_SECRET = '${jwt_secret}';
const LOGIN_PATH = '${login_path}';
const PUBLIC_PATHS = [LOGIN_PATH, '/favicon.ico', '/robots.txt'];

function isPublicPath(uri) {
  for (let i = 0; i < PUBLIC_PATHS.length; i++) {
    if (PUBLIC_PATHS[i] === uri) return true;
  }
  if (uri.indexOf('/_astro/') === 0) return true;
  return false;
}

// Astro builds directory-format output (login/index.html), so rewrite URIs
// that look like page routes before forwarding to S3.
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;

  // Route all CSR shell paths to their index.html
  if (uri.indexOf('/skills') === 0) return '/skills/index.html';
  if (uri.indexOf('/plugins') === 0) return '/plugins/index.html';
  if (uri.indexOf('/agents') === 0) return '/agents/index.html';
  if (uri.indexOf('/category') === 0) return '/category/index.html';
  if (uri.indexOf('/admin') === 0) return '/admin/index.html';
  if (uri.indexOf('/submit') === 0) return '/submit/index.html';
  if (uri.indexOf('/contracts') === 0) return '/contracts/index.html';

  return uri + '/index.html';
}

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const headerPayload = parts[0] + '.' + parts[1];
  const sig = parts[2];

  try {
    const expected = crypto.createHmac('sha256', secret)
      .update(headerPayload)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    if (expected.length !== sig.length) return false;
    let xor = 0;
    for (let i = 0; i < expected.length; i++) {
      xor |= (expected.charCodeAt(i) ^ sig.charCodeAt(i));
    }
    if (xor !== 0) return false;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;

    return true;
  } catch(e) {
    return false;
  }
}

async function handler(event) {
  const request = event.request;
  const uri = request.uri;

  if (isPublicPath(uri)) {
    request.uri = rewriteUri(uri);
    return request;
  }

  const sessionCookie = request.cookies['__session'];
  if (!sessionCookie || !sessionCookie.value) {
    return redirect(LOGIN_PATH, uri);
  }

  const valid = verifyJWT(sessionCookie.value, JWT_SECRET);

  if (!valid) {
    return {
      statusCode: 302,
      headers: { location: { value: LOGIN_PATH } },
      cookies: {
        '__session': { value: '', attributes: 'HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/' },
        '__user': { value: '', attributes: 'Secure; SameSite=Lax; Max-Age=0; Path=/' },
      },
    };
  }

  request.uri = rewriteUri(uri);
  return request;
}

function redirect(path, returnTo) {
  const dest = returnTo && returnTo !== LOGIN_PATH
    ? path + '?return_to=' + encodeURIComponent(returnTo)
    : path;
  return {
    statusCode: 302,
    headers: { location: { value: dest } },
  };
}
