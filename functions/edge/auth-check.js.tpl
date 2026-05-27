// CloudFront Function (cloudfront-js-2.0 runtime)
// Runs on every viewer request BEFORE CloudFront checks the cache.
// Validates the __session JWT against the KVS-stored secret.
// Unauthenticated requests are redirected to /login.
//
// Template variables injected by Terraform:
//   ${kvs_arn}    - CloudFront Key Value Store ARN
//   ${login_path} - Path to redirect unauthenticated users

import cf from 'cloudfront';

const KVS_ARN = '${kvs_arn}';
const LOGIN_PATH = '${login_path}';

// Paths that never require authentication
const PUBLIC_PATHS = new Set([
  LOGIN_PATH,
  '/favicon.ico',
  '/robots.txt',
]);

function isPublicPath(uri) {
  if (PUBLIC_PATHS.has(uri)) return true;
  // Static Astro build assets are public so the login page can load its CSS/JS
  if (uri.startsWith('/_astro/')) return true;
  return false;
}

async function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const b64 = pad ? padded + '='.repeat(4 - pad) : padded;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [header, payload, signature] = parts;
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = await base64UrlDecode(signature);
    const data = encoder.encode(`$${header}.$${payload}`);

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
    if (!valid) return false;

    // Decode payload and check expiry
    const payloadBytes = await base64UrlDecode(payload);
    const decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp && decoded.exp < now) return false;

    return true;
  } catch {
    return false;
  }
}

async function handler(event) {
  const request = event.request;
  const uri = request.uri;

  if (isPublicPath(uri)) {
    return request;
  }

  const sessionCookie = request.cookies['__session'];

  if (!sessionCookie?.value) {
    return redirect(LOGIN_PATH, uri);
  }

  let secret;
  try {
    const kvsHandle = cf.kvs(KVS_ARN);
    secret = await kvsHandle.get('jwt_secret');
  } catch {
    // KVS unavailable - fail closed
    return redirect(LOGIN_PATH, uri);
  }

  const valid = await verifyJWT(sessionCookie.value, secret);

  if (!valid) {
    return {
      statusCode: 302,
      headers: {
        location: { value: LOGIN_PATH },
        'set-cookie': {
          value: '__session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'
        },
      },
    };
  }

  return request;
}

function redirect(path, returnTo) {
  const dest = returnTo && returnTo !== LOGIN_PATH
    ? `$${path}?return_to=$${encodeURIComponent(returnTo)}`
    : path;
  return {
    statusCode: 302,
    headers: { location: { value: dest } },
  };
}
