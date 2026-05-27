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

const PUBLIC_PATHS = [LOGIN_PATH, '/favicon.ico', '/robots.txt'];

function isPublicPath(uri) {
  for (let i = 0; i < PUBLIC_PATHS.length; i++) {
    if (PUBLIC_PATHS[i] === uri) return true;
  }
  if (uri.indexOf('/_astro/') === 0) return true;
  return false;
}

// Astro builds output login/index.html (directory format).
// S3 won't find /login without the full path, so rewrite before forwarding.
function rewriteUri(uri) {
  if (uri === '/') return uri;
  const lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') !== -1) return uri;
  return uri + '/index.html';
}

async function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  let b64 = padded;
  if (pad === 1) { b64 = padded + '==='; }
  else if (pad === 2) { b64 = padded + '=='; }
  else if (pad === 3) { b64 = padded + '='; }
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

  const jwtHeader = parts[0];
  const jwtPayload = parts[1];
  const jwtSig = parts[2];
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = await base64UrlDecode(jwtSig);
    const data = encoder.encode(jwtHeader + '.' + jwtPayload);

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
    if (!valid) return false;

    const payloadBytes = await base64UrlDecode(jwtPayload);
    const decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp && decoded.exp < now) return false;

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

  let secret;
  try {
    const kvsHandle = cf.kvs(KVS_ARN);
    secret = await kvsHandle.get('jwt_secret');
  } catch(e) {
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
