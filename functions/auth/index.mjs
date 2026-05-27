import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createHmac } from 'crypto';

const ssm = new SSMClient({ region: process.env.AWS_REGION });

// Cache SSM values for the lifetime of the Lambda container
const paramCache = {};

async function getParam(name) {
  if (paramCache[name]) return paramCache[name];
  const res = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true })
  );
  paramCache[name] = res.Parameter.Value;
  return paramCache[name];
}

function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJWT(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${signature}`;
}

function decodeJWTPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function htmlResponse(statusCode, title, message, redirect = null) {
  const meta = redirect ? `<meta http-equiv="refresh" content="3;url=${redirect}">` : '';
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><title>${title}</title>${meta}</head>
<body><p>${message}</p>${redirect ? `<p><a href="${redirect}">Click here if not redirected</a></p>` : ''}</body></html>`,
  };
}

export const handler = async (event) => {
  const path = event.rawPath || '/';
  const qs = event.queryStringParameters || {};

  // Secrets from SSM (cached after first invocation)
  const [clientId, clientSecret, jwtSecret] = await Promise.all([
    getParam(process.env.GOOGLE_CLIENT_ID_PARAM),
    getParam(process.env.GOOGLE_CLIENT_SECRET_PARAM),
    getParam(process.env.JWT_SECRET_PARAM),
  ]);

  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
  const siteUrl = process.env.SITE_URL;

  // Always use SITE_URL for the callback so it resolves to the CloudFront domain.
  // Requests now arrive via CloudFront (/auth/* behavior), so the cookie set in
  // the callback response lands on the CloudFront domain, not the Lambda URL domain.
  const callbackUrl = siteUrl + '/auth/callback';

  // ----------------------------------------------------------------
  // /auth/login  →  redirect to Google OAuth consent screen
  // ----------------------------------------------------------------
  if (path === '/auth/login') {
    const returnTo = qs.return_to || '/';
    const state = Buffer.from(JSON.stringify({ return_to: returnTo }))
      .toString('base64url');

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');

    return {
      statusCode: 302,
      headers: { location: url.toString() },
      body: '',
    };
  }

  // ----------------------------------------------------------------
  // /auth/callback  →  exchange code, validate domain, issue cookie
  // ----------------------------------------------------------------
  if (path === '/auth/callback') {
    if (qs.error) {
      return htmlResponse(400, 'Auth Error', `Google returned an error: ${qs.error}`);
    }

    if (!qs.code) {
      return htmlResponse(400, 'Missing Code', 'No authorization code in callback.');
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: qs.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.id_token) {
      console.error('Token exchange failed:', tokens);
      return htmlResponse(500, 'Auth Failed', 'Token exchange failed. Check Lambda logs.');
    }

    const idPayload = decodeJWTPayload(tokens.id_token);
    const email = idPayload.email;

    if (!email || !email.endsWith(`@${allowedDomain}`)) {
      return htmlResponse(
        403,
        'Access Denied',
        `This tool is restricted to @${allowedDomain} accounts. You signed in as ${email || 'unknown'}.`
      );
    }

    // Issue an 8-hour session JWT
    const sessionToken = createJWT(
      {
        sub: email,
        name: idPayload.name,
        picture: idPayload.picture,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
      },
      jwtSecret
    );

    // Decode return_to from state if present
    let returnTo = '/';
    if (qs.state) {
      try {
        const stateData = JSON.parse(
          Buffer.from(qs.state, 'base64url').toString('utf8')
        );
        returnTo = stateData.return_to || '/';
      } catch {
        // ignore malformed state
      }
    }

    const destination = returnTo.startsWith('/') ? `${siteUrl}${returnTo}` : siteUrl;

    // Non-HttpOnly cookie for client-side display (name, email, picture).
    // Access control is handled solely by __session; this carries no auth weight.
    const userInfo = Buffer.from(JSON.stringify({
      name: idPayload.name,
      email,
      picture: idPayload.picture,
    })).toString('base64url');

    return {
      statusCode: 302,
      headers: { location: destination },
      cookies: [
        `__session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=28800; Path=/`,
        `__user=${userInfo}; Secure; SameSite=Lax; Max-Age=28800; Path=/`,
      ],
      body: '',
    };
  }

  return htmlResponse(404, 'Not Found', 'Not found.');
};
