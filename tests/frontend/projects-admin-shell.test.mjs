import { describe, it, expect } from 'vitest';
import { canAccessProjectsAdmin } from '../../src/scripts/projects-admin/index.mjs';
import { canAccessAdminPage } from '../../src/scripts/admin/index.mjs';

describe('canAccessProjectsAdmin', () => {
  it('admits projects-admin', () => {
    expect(canAccessProjectsAdmin({ role: 'projects-admin' })).toBe(true);
  });

  it('admits admin, who is a superuser everywhere', () => {
    expect(canAccessProjectsAdmin({ role: 'admin' })).toBe(true);
  });

  it('refuses maintain — curation does not imply reference-data ownership', () => {
    expect(canAccessProjectsAdmin({ role: 'maintain' })).toBe(false);
  });

  it('refuses user', () => {
    expect(canAccessProjectsAdmin({ role: 'user' })).toBe(false);
  });

  it('refuses an unrecognised future role rather than admitting it', () => {
    expect(canAccessProjectsAdmin({ role: 'some-future-role' })).toBe(false);
  });

  it('refuses a failed user fetch rather than defaulting to authorised', () => {
    expect(canAccessProjectsAdmin(null)).toBe(false);
    expect(canAccessProjectsAdmin(undefined)).toBe(false);
  });
});

// The two pages must not overlap: each role belongs to exactly one of them (or
// neither), except admin, who is a superuser. This is the property that broke on
// /admin before — a gate that admitted a role it had never heard of.
describe('the two admin surfaces are disjoint apart from admin', () => {
  const cases = [
    ['admin',          true,  true],
    ['maintain',       true,  false],
    ['projects-admin', false, true],
    ['user',           false, false],
    ['future-role',    false, false],
  ];

  for (const [role, adminPage, projectsPage] of cases) {
    it(`${role}: /admin=${adminPage}, /projects-admin=${projectsPage}`, () => {
      expect(canAccessAdminPage({ role })).toBe(adminPage);
      expect(canAccessProjectsAdmin({ role })).toBe(projectsPage);
    });
  }
});
