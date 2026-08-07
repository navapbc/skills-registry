import { vi, describe, it, expect } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {}),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(function () { return { send: mockSend }; }) },
  GetCommand: vi.fn(function (p) { return { type: 'Get', params: p }; }),
  PutCommand: vi.fn(function (p) { return { type: 'Put', params: p }; }),
  UpdateCommand: vi.fn(function (p) { return { type: 'Update', params: p }; }),
  DeleteCommand: vi.fn(function (p) { return { type: 'Delete', params: p }; }),
  ScanCommand: vi.fn(function (p) { return { type: 'Scan', params: p }; }),
  QueryCommand: vi.fn(function (p) { return { type: 'Query', params: p }; }),
  BatchGetCommand: vi.fn(function (p) { return { type: 'BatchGet', params: p }; }),
}));

// Must import AFTER mocks are set up
const { getOrCreateUser, upsertUser, tables } = await import('../../../functions/api/lib/dynamo.mjs');

const USER = { user_id: 'test@navapbc.com', email: 'test@navapbc.com', name: 'Test', avatar_url: null };

describe('getOrCreateUser', () => {
  it('returns existing user when found', async () => {
    const existing = { ...USER, role: 'admin' };
    mockSend.mockResolvedValueOnce({ Item: existing });
    const result = await getOrCreateUser(USER);
    expect(result).toEqual(existing);
  });

  it('creates and returns new user when not found', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })  // GetCommand — not found
      .mockResolvedValueOnce({});                  // PutCommand — success
    const result = await getOrCreateUser(USER);
    expect(result.user_id).toBe(USER.user_id);
    expect(result.role).toBe('user');
  });

  it('handles race condition — ConditionalCheckFailedException on create', async () => {
    const existing = { ...USER, role: 'user' };
    mockSend
      .mockResolvedValueOnce({ Item: undefined })  // initial Get — not found
      .mockRejectedValueOnce(Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }))
      .mockResolvedValueOnce({ Item: existing });  // refetch Get
    const result = await getOrCreateUser(USER);
    expect(result).toEqual(existing);
  });

  it('rethrows non-conditional errors', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockRejectedValueOnce(new Error('DynamoDB timeout'));
    await expect(getOrCreateUser(USER)).rejects.toThrow('DynamoDB timeout');
  });
});

describe('tables.projectReference', () => {
  it('returns the configured table name', () => {
    const prev = process.env.PROJECT_REFERENCE_TABLE;
    process.env.PROJECT_REFERENCE_TABLE = 'skills-hub-project-reference-staging';
    try {
      expect(tables.projectReference()).toBe('skills-hub-project-reference-staging');
    } finally {
      if (prev === undefined) delete process.env.PROJECT_REFERENCE_TABLE;
      else process.env.PROJECT_REFERENCE_TABLE = prev;
    }
  });

  // Matches every other accessor: a missing variable surfaces later as a
  // DynamoDB error naming the table, not as a module-load crash.
  it('returns undefined when the variable is unset, rather than throwing', () => {
    const prev = process.env.PROJECT_REFERENCE_TABLE;
    delete process.env.PROJECT_REFERENCE_TABLE;
    try {
      expect(tables.projectReference()).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.PROJECT_REFERENCE_TABLE = prev;
    }
  });
});

describe('tables.projects', () => {
  it('returns the configured table name', () => {
    const prev = process.env.PROJECTS_TABLE;
    process.env.PROJECTS_TABLE = 'skills-hub-projects-staging';
    try {
      expect(tables.projects()).toBe('skills-hub-projects-staging');
    } finally {
      if (prev === undefined) delete process.env.PROJECTS_TABLE;
      else process.env.PROJECTS_TABLE = prev;
    }
  });

  it('returns undefined when the variable is unset, rather than throwing', () => {
    const prev = process.env.PROJECTS_TABLE;
    delete process.env.PROJECTS_TABLE;
    try {
      expect(tables.projects()).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.PROJECTS_TABLE = prev;
    }
  });
});

describe('upsertUser', () => {
  it('updates user and returns attributes', async () => {
    const updated = { ...USER, role: 'user', last_seen_at: new Date().toISOString() };
    mockSend.mockResolvedValueOnce({ Attributes: updated });
    const result = await upsertUser(USER);
    expect(result).toEqual(updated);
  });
});

describe('tables.contracts', () => {
  it('returns the configured table name', () => {
    const prev = process.env.CONTRACTS_TABLE;
    process.env.CONTRACTS_TABLE = 'skills-hub-contracts-staging';
    try {
      expect(tables.contracts()).toBe('skills-hub-contracts-staging');
    } finally {
      if (prev === undefined) delete process.env.CONTRACTS_TABLE;
      else process.env.CONTRACTS_TABLE = prev;
    }
  });

  it('returns undefined when the variable is unset, rather than throwing', () => {
    // The projects route treats this as "not checked" rather than failing, so an
    // environment deployed before the table exists still serves its tab.
    const prev = process.env.CONTRACTS_TABLE;
    delete process.env.CONTRACTS_TABLE;
    try {
      expect(tables.contracts()).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.CONTRACTS_TABLE = prev;
    }
  });
});
