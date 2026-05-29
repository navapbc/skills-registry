import { createHmac } from 'crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { getCookie } from 'hono/cookie';
import { getOrCreateUser } from '../lib/dynamo.mjs';

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const paramCache = {};

async function getParam(name) {
  if (paramCache[name]) return paramCache[name];
  const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  paramCache[name] = res.Parameter.Value;
  return paramCache[name];
}

export function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sig] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (expected.length !== sig.length) return null;
  let xor = 0;
  for (let i = 0; i < expected.length; i++) {
    xor |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (xor !== 0) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function authMiddleware(c, next) {
  const jwtSecret = await getParam(process.env.JWT_SECRET_PARAM);
  const token = getCookie(c, '__session');

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = verifyJWT(token, jwtSecret);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const user = await getOrCreateUser({
    user_id: payload.sub,
    email: payload.sub,
    name: payload.name ?? payload.sub,
    avatar_url: payload.picture ?? null,
  });

  c.set('user', user);
  await next();
}
