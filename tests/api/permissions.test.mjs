import { describe, it, expect } from 'vitest';
import { can, atLeast } from '../../functions/api/lib/permissions.mjs';

const admin    = { user_id: 'admin@navapbc.com',    role: 'admin'    };
const maintain = { user_id: 'maintain@navapbc.com', role: 'maintain' };
const user     = { user_id: 'user@navapbc.com',     role: 'user'     };

const publicApproved   = { slug: 'x', visibility: 'public',   status: 'approved', created_by: user.user_id };
const internalApproved = { slug: 'x', visibility: 'internal', status: 'approved', created_by: user.user_id };
const ownPending       = { slug: 'x', visibility: 'public',   status: 'pending',  created_by: user.user_id };
const otherPending     = { slug: 'x', visibility: 'public',   status: 'pending',  created_by: 'other@navapbc.com' };
const ownPrivate       = { slug: 'x', visibility: 'private',  status: 'approved', created_by: user.user_id };
const otherPrivate     = { slug: 'x', visibility: 'private',  status: 'approved', created_by: 'other@navapbc.com' };
const ownHidden        = { slug: 'x', visibility: 'hidden',   status: 'approved', created_by: user.user_id };
const otherHidden      = { slug: 'x', visibility: 'hidden',   status: 'approved', created_by: 'other@navapbc.com' };

describe('can — read:skill', () => {
  it('user can read public approved skill', () => {
    expect(can(user, 'read:skill', publicApproved)).toBe(true);
  });
  it('user can read internal approved skill', () => {
    expect(can(user, 'read:skill', internalApproved)).toBe(true);
  });
  it('user can read their own pending skill', () => {
    expect(can(user, 'read:skill', ownPending)).toBe(true);
  });
  it('user cannot read another user pending skill', () => {
    expect(can(user, 'read:skill', otherPending)).toBe(false);
  });
  it('user can read their own private skill', () => {
    expect(can(user, 'read:skill', ownPrivate)).toBe(true);
  });
  it('user cannot read another user private skill', () => {
    expect(can(user, 'read:skill', otherPrivate)).toBe(false);
  });
  it('user cannot read hidden skill even if they are the creator', () => {
    expect(can(user, 'read:skill', ownHidden)).toBe(false);
  });
  it('user cannot read hidden skill from another user', () => {
    expect(can(user, 'read:skill', otherHidden)).toBe(false);
  });
  it('maintain cannot read hidden skill from another user', () => {
    expect(can(maintain, 'read:skill', otherHidden)).toBe(false);
  });
  it('admin can read any skill including hidden', () => {
    expect(can(admin, 'read:skill', otherPending)).toBe(true);
    expect(can(admin, 'read:skill', otherPrivate)).toBe(true);
    expect(can(admin, 'read:skill', otherHidden)).toBe(true);
    expect(can(admin, 'read:skill', ownHidden)).toBe(true);
  });
});

describe('can — create:skill', () => {
  it('any authenticated user can create a skill', () => {
    expect(can(user, 'create:skill')).toBe(true);
  });
});

describe('can — update:skill', () => {
  it('user can update their own skill', () => {
    expect(can(user, 'update:skill', publicApproved)).toBe(true);
  });
  it('user cannot update another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'update:skill', otherSkill)).toBe(false);
  });
  it('admin can update any skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(admin, 'update:skill', otherSkill)).toBe(true);
  });
});

describe('can — approve:skill / reject:skill', () => {
  it('user cannot approve or reject', () => {
    expect(can(user, 'approve:skill', ownPending)).toBe(false);
    expect(can(user, 'reject:skill', ownPending)).toBe(false);
  });
  it('maintain can approve or reject', () => {
    expect(can(maintain, 'approve:skill', ownPending)).toBe(true);
    expect(can(maintain, 'reject:skill', ownPending)).toBe(true);
  });
  it('admin can approve or reject', () => {
    expect(can(admin, 'approve:skill', ownPending)).toBe(true);
    expect(can(admin, 'reject:skill', ownPending)).toBe(true);
  });
});

describe('can — admin-only actions', () => {
  it('user cannot access admin actions', () => {
    expect(can(user, 'read:users')).toBe(false);
    expect(can(user, 'set:role')).toBe(false);
    expect(can(user, 'manage:plugins')).toBe(false);
    expect(can(user, 'read:audit')).toBe(false);
  });
  it('admin can perform all admin actions', () => {
    expect(can(admin, 'read:users')).toBe(true);
    expect(can(admin, 'set:role')).toBe(true);
    expect(can(admin, 'manage:plugins')).toBe(true);
    expect(can(admin, 'read:audit')).toBe(true);
  });
});

describe('can — maintain role: manage plugins', () => {
  it('maintain can manage plugins', () => {
    expect(can(maintain, 'manage:plugins')).toBe(true);
  });
  it('user cannot manage plugins', () => {
    expect(can(user, 'manage:plugins')).toBe(false);
  });
});

describe('can — maintain role: edit any skill', () => {
  it('maintain can edit any skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(maintain, 'update:skill', otherSkill)).toBe(true);
  });
  it('user can still edit their own skill', () => {
    expect(can(user, 'update:skill', publicApproved)).toBe(true);
  });
  it('user cannot edit another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'update:skill', otherSkill)).toBe(false);
  });
});

describe('can — maintain role: enterprise', () => {
  it('maintain can manage enterprise skills', () => {
    expect(can(maintain, 'manage:enterprise')).toBe(true);
  });
  it('user cannot manage enterprise skills', () => {
    expect(can(user, 'manage:enterprise')).toBe(false);
  });
});

describe('can — delete:skill is admin-only', () => {
  it('user cannot delete any skill (admin-only now)', () => {
    expect(can(user, 'delete:skill', publicApproved)).toBe(false);
  });
  it('maintain cannot delete skills', () => {
    expect(can(maintain, 'delete:skill', publicApproved)).toBe(false);
  });
  it('admin can delete any skill', () => {
    expect(can(admin, 'delete:skill', publicApproved)).toBe(true);
  });
});

describe('can — delete:plugin is admin-only', () => {
  it('user cannot delete plugin', () => {
    expect(can(user, 'delete:plugin')).toBe(false);
  });
  it('maintain cannot delete plugin', () => {
    expect(can(maintain, 'delete:plugin')).toBe(false);
  });
  it('admin can delete plugin', () => {
    expect(can(admin, 'delete:plugin')).toBe(true);
  });
});

describe('atLeast helper', () => {
  it('user is not at least maintain', () => {
    expect(atLeast(user, 'maintain')).toBe(false);
  });
  it('maintain is at least maintain', () => {
    expect(atLeast(maintain, 'maintain')).toBe(true);
  });
  it('admin is at least maintain', () => {
    expect(atLeast(admin, 'maintain')).toBe(true);
  });
});

// `projects-admin` is orthogonal to the rank ladder, not a rung in it: it grants
// the project-reference capability and confers no rank. These tests are the guard
// against it silently acquiring a rank-gated action later.
const projectsAdmin = { user_id: 'pa@navapbc.com', role: 'projects-admin' };

describe('can — manage:project-reference', () => {
  it('projects-admin is granted the capability', () => {
    expect(can(projectsAdmin, 'manage:project-reference')).toBe(true);
  });
  it('admin is granted the capability', () => {
    expect(can(admin, 'manage:project-reference')).toBe(true);
  });
  it('maintain is denied the capability', () => {
    expect(can(maintain, 'manage:project-reference')).toBe(false);
  });
  it('user is denied the capability', () => {
    expect(can(user, 'manage:project-reference')).toBe(false);
  });
  it('an unauthenticated caller is denied the capability', () => {
    expect(can(null, 'manage:project-reference')).toBe(false);
  });
});

describe('can — projects-admin is denied every privileged action', () => {
  // Asserted individually, not in aggregate, so an action added to a rank-gated
  // set in future cannot silently leak to this role.
  const PRIVILEGED = [
    'approve:skill',
    'reject:skill',
    'edit:any-skill',
    'manage:plugins',
    'manage:enterprise',
    'read:users',
    'set:role',
    'read:audit',
    'delete:skill',
    'delete:plugin',
  ];
  for (const action of PRIVILEGED) {
    it(`denies ${action}`, () => {
      expect(can(projectsAdmin, action)).toBe(false);
    });
  }
});

describe('can — projects-admin retains the baseline user floor', () => {
  // "Grants these two tabs and nothing else" means nothing else *privileged*.
  // The permission module grants these unconditionally to any signed-in user,
  // so the floor is deliberate — asserting it stops a future implementer from
  // "fixing" what looks like a leak.
  it('can submit a skill', () => {
    expect(can(projectsAdmin, 'create:skill')).toBe(true);
  });
  it('can read an approved public skill', () => {
    expect(can(projectsAdmin, 'read:skill', publicApproved)).toBe(true);
  });
  it('can update a skill it created', () => {
    expect(can(projectsAdmin, 'update:skill', { created_by: projectsAdmin.user_id })).toBe(true);
  });
  it('cannot update a skill someone else created', () => {
    expect(can(projectsAdmin, 'update:skill', { created_by: 'other@navapbc.com' })).toBe(false);
  });
});

describe('atLeast — projects-admin sits outside the ladder', () => {
  it('is not at least maintain', () => {
    expect(atLeast(projectsAdmin, 'maintain')).toBe(false);
  });
  it('is not at least admin', () => {
    expect(atLeast(projectsAdmin, 'admin')).toBe(false);
  });
});

describe('can — unknown action returns false', () => {
  it('user returns false for unrecognised action', () => {
    expect(can(user, 'nonexistent:action')).toBe(false);
  });
  it('maintain returns false for unrecognised action', () => {
    expect(can(maintain, 'fly:to:moon')).toBe(false);
  });
});
