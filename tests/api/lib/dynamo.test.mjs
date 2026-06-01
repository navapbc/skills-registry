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
const { getOrCreateUser, upsertUser } = await import('../../../functions/api/lib/dynamo.mjs');

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

describe('upsertUser', () => {
  it('updates user and returns attributes', async () => {
    const updated = { ...USER, role: 'user', last_seen_at: new Date().toISOString() };
    mockSend.mockResolvedValueOnce({ Attributes: updated });
    const result = await upsertUser(USER);
    expect(result).toEqual(updated);
  });
});
