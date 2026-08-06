import { describe, it, expect } from 'vitest';
import { canAccessAdminPage } from '../../src/scripts/admin/index.mjs';

// The gate used to be a blocklist (`role === 'user'` redirects). That admitted
// every other role, including capability roles that have no business here — they
// would render the seven-tab shell and watch each loader 403. These tests pin the
// allowlist so a future role addition cannot silently regain access.
describe('canAccessAdminPage', () => {
  it('admits admin', () => {
    expect(canAccessAdminPage({ role: 'admin' })).toBe(true);
  });

  it('admits maintain', () => {
    expect(canAccessAdminPage({ role: 'maintain' })).toBe(true);
  });

  it('refuses projects-admin — it has its own page and would 403 on every tab', () => {
    expect(canAccessAdminPage({ role: 'projects-admin' })).toBe(false);
  });

  it('refuses user', () => {
    expect(canAccessAdminPage({ role: 'user' })).toBe(false);
  });

  it('refuses an unrecognised future role rather than admitting it', () => {
    expect(canAccessAdminPage({ role: 'some-future-capability-role' })).toBe(false);
  });

  it('refuses a failed user fetch rather than defaulting to authorised', () => {
    expect(canAccessAdminPage(null)).toBe(false);
    expect(canAccessAdminPage(undefined)).toBe(false);
  });

  it('refuses a user record with no role field', () => {
    expect(canAccessAdminPage({ email: 'x@navapbc.com' })).toBe(false);
  });
});
