# CloudFront Functions JWT Authentication: How We Solved It

## What We Were Building

A static Astro site on S3 + CloudFront, restricted to `@navapbc.com` Google accounts. The auth flow:

1. CloudFront edge function checks every request for a valid `__session` JWT cookie
2. Unauthenticated requests → redirect to `/login`
3. Login page → Google OAuth via Lambda → sets `__session` cookie on CloudFront domain → redirect back to site

---

## Problem 1: Cookie Set on Wrong Domain

**Symptom:** After OAuth, the `__session` cookie was visible in DevTools but under `*.lambda-url.us-east-1.on.aws`, not the CloudFront domain. The edge function never saw it.

**Root cause:** The OAuth callback URL was being constructed from the Lambda's own hostname (the `host` header of the incoming request). Since Google redirected directly to the Lambda URL, the cookie landed on the Lambda domain and was never sent to CloudFront.

**Fix:** Route `/auth/*` through CloudFront as a second origin (no auth function, no caching), and hardcode the callback URL to the CloudFront domain:

```javascript
// functions/auth/index.mjs
const callbackUrl = siteUrl + '/auth/callback'; // CloudFront domain, always
```

```hcl
# terraform/cloudfront.tf
origin {
  domain_name = trimprefix(trimsuffix(aws_lambda_function_url.auth.function_url, "/"), "https://")
  origin_id   = "lambda-auth"
  custom_origin_config { ... }
}

ordered_cache_behavior {
  path_pattern             = "/auth/*"
  target_origin_id         = "lambda-auth"
  cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
  origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader
  # No function_association — auth routes bypass the JWT check
}
```

This also broke a Terraform circular dependency (CloudFront domain → Lambda env var → CloudFront), solved by adding a `site_url` input variable set manually after the first apply.

---

## Problem 2: CloudFront Key Value Store Failing (`KVSNamespaceNotFound`)

**Symptom:** Cookie was correctly on the CloudFront domain, but the edge function still redirected to `/login`. Adding debug logs revealed:

```
KVS_FAIL: KVSNamespaceNotFound
```

The KVS existed, had the right key/value, and the function was associated with it — but `cf.kvs(ARN)` threw at runtime.

**Root cause:** Unknown — the association appeared correct in both `describe-function` and the AWS console. After extensive debugging, KVS was abandoned in favor of embedding the secret directly in the function code via Terraform's `templatefile()`:

```hcl
# terraform/cloudfront.tf
code = templatefile("${path.module}/../functions/edge/auth-check.js.tpl", {
  jwt_secret = var.jwt_secret
  login_path = "/login"
})
```

The secret is a hex string (`openssl rand -hex 32`), so embedding it in a JS string literal is safe. Access to the function code requires the same IAM permissions as reading KVS, so the security posture is equivalent.

---

## Problem 3: `crypto` Not Available as a Global

**Symptom:** After removing the KVS dependency, the edge function still redirected to `/login`. Adding debug logging revealed:

```
EXCEPTION: "crypto" is not defined
```

Attempts to use `crypto.subtle` (Web Crypto API) and `globalThis.crypto` both failed. The CloudFront Functions 2.0 runtime does **not** expose `crypto` as a global — despite AWS docs implying Web Crypto support.

**Root cause:** CloudFront Functions 2.0 exposes crypto via a **Node.js-style built-in module**, not a browser-style global. You must `import` it:

```javascript
import crypto from 'crypto';
```

The API is `createHmac`, not `subtle`:

```javascript
// ✗ Does not work in CloudFront Functions
const key = await crypto.subtle.importKey('raw', ...);
const sig = await crypto.subtle.sign('HMAC', key, data);

// ✓ Correct API
const sig = crypto.createHmac('sha256', secret)
  .update(headerPayload)
  .digest('base64url');
```

**Why it was hard to debug:** The CloudFront Functions test API (`aws cloudfront test-function`) also does not expose the crypto module — tests fail even for code that works correctly in production. This made it impossible to confirm the fix via the test API alone.

---

## Final Edge Function Pattern

```javascript
import crypto from 'crypto';

const JWT_SECRET = '${jwt_secret}'; // injected by Terraform templatefile()
const LOGIN_PATH = '${login_path}';

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const expected = crypto.createHmac('sha256', secret)
      .update(parts[0] + '.' + parts[1])
      .digest('base64url');

    // Constant-time comparison
    if (expected.length !== parts[2].length) return false;
    let xor = 0;
    for (let i = 0; i < expected.length; i++) {
      xor |= (expected.charCodeAt(i) ^ parts[2].charCodeAt(i));
    }
    if (xor !== 0) return false;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return !payload.exp || payload.exp >= Math.floor(Date.now() / 1000);
  } catch(e) {
    return false;
  }
}
```

---

## Key Lessons

| Assumption | Reality |
|---|---|
| `crypto` is a global in CF Functions 2.0 | Must `import crypto from 'crypto'` |
| `crypto.subtle` works like in browsers | Not available — use `createHmac` |
| CF Functions test API matches production | Test API lacks `crypto` and KVS; test failures can be false negatives |
| KVS is the right way to store edge secrets | Embedding via `templatefile()` is simpler and equally secure for this use case |

---

## Relevant Docs

- [CloudFront Functions JS runtime 2.0 — built-in modules (crypto section)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html#writing-functions-javascript-features-builtin-modules-crypto-20)
- [AWS example: JWT verification in a CloudFront Function](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_kvs_jwt_verify_section.html)
- [aws-samples/amazon-cloudfront-functions on GitHub](https://github.com/aws-samples/amazon-cloudfront-functions)
- [CloudFront Functions restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html#cloudfront-functions-restrictions)
