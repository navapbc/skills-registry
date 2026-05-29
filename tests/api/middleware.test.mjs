import { vi, describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';

// auth.mjs imports dynamo.mjs — mock it so the module resolves before dynamo.mjs is written
vi.mock('../../functions/api/lib/dynamo.mjs', () => ({ upsertUser: vi.fn() }));
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(function () { return { send: vi.fn() }; }),
  GetParameterCommand: vi.fn(),
}));
vi.mock('hono/cookie', () => ({ getCookie: vi.fn() }));

import { verifyJWT } from '../../functions/api/middleware/auth.mjs';

const SECRET = 'test-secret-value-32-chars-min!!';

function signJWT(payload, secret = SECRET) {
  const b64 = (s) =>
    Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${h}.${p}.${sig}`;
}

describe('verifyJWT', () => {
  it('returns payload for a valid token', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = verifyJWT(token, SECRET);
    expect(result).not.toBeNull();
    expect(result.sub).toBe('user@navapbc.com');
  });

  it('returns null for an expired token', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyJWT(token, SECRET)).toBeNull();
  });

  it('returns null when signed with a different secret', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret');
    expect(verifyJWT(token, SECRET)).toBeNull();
  });

  it('returns null for a tampered payload', () => {
    const token = signJWT({ sub: 'user@navapbc.com', exp: Math.floor(Date.now() / 1000) + 3600 });
    const [h, , sig] = token.split('.');
    const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin@navapbc.com', exp: 9999999999 }))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(verifyJWT(`${h}.${fakePayload}.${sig}`, SECRET)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyJWT('not-a-jwt', SECRET)).toBeNull();
    expect(verifyJWT('only.two', SECRET)).toBeNull();
    expect(verifyJWT('', SECRET)).toBeNull();
  });
});
