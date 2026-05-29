import { describe, it, expect } from 'vitest';
import { can } from '../../functions/api/lib/permissions.mjs';

const admin = { user_id: 'admin@navapbc.com', role: 'admin' };
const user  = { user_id: 'user@navapbc.com',  role: 'user'  };

const publicApproved   = { slug: 'x', visibility: 'public',   status: 'approved', created_by: user.user_id };
const internalApproved = { slug: 'x', visibility: 'internal', status: 'approved', created_by: user.user_id };
const ownPending       = { slug: 'x', visibility: 'public',   status: 'pending',  created_by: user.user_id };
const otherPending     = { slug: 'x', visibility: 'public',   status: 'pending',  created_by: 'other@navapbc.com' };
const ownPrivate       = { slug: 'x', visibility: 'private',  status: 'approved', created_by: user.user_id };
const otherPrivate     = { slug: 'x', visibility: 'private',  status: 'approved', created_by: 'other@navapbc.com' };

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
  it('admin can read any skill', () => {
    expect(can(admin, 'read:skill', otherPending)).toBe(true);
    expect(can(admin, 'read:skill', otherPrivate)).toBe(true);
  });
});

describe('can — create:skill', () => {
  it('any authenticated user can create a skill', () => {
    expect(can(user, 'create:skill')).toBe(true);
  });
});

describe('can — update:skill / delete:skill', () => {
  it('user can update their own skill', () => {
    expect(can(user, 'update:skill', publicApproved)).toBe(true);
  });
  it('user cannot update another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'update:skill', otherSkill)).toBe(false);
  });
  it('user can delete their own skill', () => {
    expect(can(user, 'delete:skill', publicApproved)).toBe(true);
  });
  it('user cannot delete another user skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(user, 'delete:skill', otherSkill)).toBe(false);
  });
  it('admin can update or delete any skill', () => {
    const otherSkill = { ...publicApproved, created_by: 'other@navapbc.com' };
    expect(can(admin, 'update:skill', otherSkill)).toBe(true);
    expect(can(admin, 'delete:skill', otherSkill)).toBe(true);
  });
});

describe('can — approve:skill / reject:skill', () => {
  it('user cannot approve or reject', () => {
    expect(can(user, 'approve:skill', ownPending)).toBe(false);
    expect(can(user, 'reject:skill', ownPending)).toBe(false);
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
