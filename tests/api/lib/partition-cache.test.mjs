import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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
const { cachedQueryPartition, __resetPartitionCache } = await import(
  '../../../functions/api/lib/partition-cache.mjs'
);

const TABLE = 'contracts-table';
const ITEMS = [{ contract_id: 'c1' }, { contract_id: 'c2' }];

beforeEach(() => {
  mockSend.mockReset();
  __resetPartitionCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cachedQueryPartition', () => {
  it('reads a partition and returns its items', async () => {
    mockSend.mockResolvedValueOnce({ Items: ITEMS });

    const items = await cachedQueryPartition(TABLE, 'record_type', 'contract');

    expect(items).toEqual(ITEMS);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].params).toMatchObject({
      TableName: TABLE,
      KeyConditionExpression: 'record_type = :t',
      ExpressionAttributeValues: { ':t': 'contract' },
    });
  });

  it('serves a repeat read from cache without touching DynamoDB', async () => {
    mockSend.mockResolvedValueOnce({ Items: ITEMS });

    const first = await cachedQueryPartition(TABLE, 'record_type', 'contract');
    const second = await cachedQueryPartition(TABLE, 'record_type', 'contract');

    expect(second).toEqual(first);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('caches the concatenation of a paged read, not the first page', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [ITEMS[0]], LastEvaluatedKey: { record_type: 'contract' } })
      .mockResolvedValueOnce({ Items: [ITEMS[1]] });

    const first = await cachedQueryPartition(TABLE, 'record_type', 'contract');
    const second = await cachedQueryPartition(TABLE, 'record_type', 'contract');

    expect(first).toEqual(ITEMS);
    expect(second).toEqual(ITEMS);
    // Two pages for the first read, nothing for the second.
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('forwards the second page cursor as ExclusiveStartKey', async () => {
    const cursor = { record_type: 'contract', contract_id: 'c1' };
    mockSend
      .mockResolvedValueOnce({ Items: [ITEMS[0]], LastEvaluatedKey: cursor })
      .mockResolvedValueOnce({ Items: [ITEMS[1]] });

    await cachedQueryPartition(TABLE, 'record_type', 'contract');

    expect(mockSend.mock.calls[0][0].params.ExclusiveStartKey).toBeUndefined();
    expect(mockSend.mock.calls[1][0].params.ExclusiveStartKey).toEqual(cursor);
  });

  it('does not share an entry between projected and unprojected reads', async () => {
    const projected = [{ contract_id: 'c1' }];
    mockSend
      .mockResolvedValueOnce({ Items: ITEMS })
      .mockResolvedValueOnce({ Items: projected });

    const full = await cachedQueryPartition(TABLE, 'record_type', 'contract');
    const narrow = await cachedQueryPartition(TABLE, 'record_type', 'contract', ['contract_id']);

    expect(full).toEqual(ITEMS);
    expect(narrow).toEqual(projected);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].params.ProjectionExpression).toBe('#f0');
    expect(mockSend.mock.calls[1][0].params.ExpressionAttributeNames).toEqual({
      '#f0': 'contract_id',
    });
  });

  it('does not share an entry between reads that differ only in projected fields', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ contract_id: 'c1' }] })
      .mockResolvedValueOnce({ Items: [{ project_name: 'p1' }] });

    await cachedQueryPartition(TABLE, 'record_type', 'contract', ['contract_id']);
    await cachedQueryPartition(TABLE, 'record_type', 'contract', ['project_name']);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not share an entry between partitions of the same table', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: ITEMS })
      .mockResolvedValueOnce({ Items: [{ contract_id: 'current' }] });

    await cachedQueryPartition(TABLE, 'record_type', 'contract');
    await cachedQueryPartition(TABLE, 'record_type', 'seed_meta');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not share an entry between tables', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: ITEMS })
      .mockResolvedValueOnce({ Items: [] });

    await cachedQueryPartition(TABLE, 'record_type', 'contract');
    await cachedQueryPartition('other-table', 'record_type', 'contract');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the entry has expired', async () => {
    const fresh = [{ contract_id: 'c3' }];
    mockSend
      .mockResolvedValueOnce({ Items: ITEMS })
      .mockResolvedValueOnce({ Items: fresh });

    await cachedQueryPartition(TABLE, 'record_type', 'contract');

    vi.advanceTimersByTime(59_000);
    expect(await cachedQueryPartition(TABLE, 'record_type', 'contract')).toEqual(ITEMS);
    expect(mockSend).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(await cachedQueryPartition(TABLE, 'record_type', 'contract')).toEqual(fresh);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('issues one query for two concurrent reads of the same partition', async () => {
    mockSend.mockResolvedValueOnce({ Items: ITEMS });

    const [a, b] = await Promise.all([
      cachedQueryPartition(TABLE, 'record_type', 'contract'),
      cachedQueryPartition(TABLE, 'record_type', 'contract'),
    ]);

    expect(a).toEqual(ITEMS);
    expect(b).toEqual(ITEMS);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('propagates a read failure to the caller', async () => {
    mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'));

    await expect(cachedQueryPartition(TABLE, 'record_type', 'contract')).rejects.toThrow(
      'ProvisionedThroughputExceeded',
    );
  });

  it('never caches a failure — the next read retries', async () => {
    mockSend
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ Items: ITEMS });

    await expect(cachedQueryPartition(TABLE, 'record_type', 'contract')).rejects.toThrow('boom');
    // Same tick, well inside the TTL: a cached rejection would replay here.
    await expect(cachedQueryPartition(TABLE, 'record_type', 'contract')).resolves.toEqual(ITEMS);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not raise an unhandled rejection when no caller awaits a failed read', async () => {
    // Real timers: Node needs an actual event-loop turn to decide a rejection went
    // unhandled, and the fake clock never delivers one.
    vi.useRealTimers();

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      mockSend.mockRejectedValueOnce(new Error('abandoned'));

      // Deliberately neither awaited NOR caught — that is the whole assertion. A
      // caller that has already returned attaches nothing, so the only thing
      // standing between this rejection and an unhandledRejection is the handler
      // the module attaches itself.
      cachedQueryPartition(TABLE, 'record_type', 'contract');

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does not evict a newer entry when an older read fails late', async () => {
    let failFirst;
    mockSend
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; }))
      .mockResolvedValueOnce({ Items: ITEMS });

    const failing = cachedQueryPartition(TABLE, 'record_type', 'contract');
    const guarded = failing.catch(() => 'failed');

    // Expire the in-flight entry so the next call starts a fresh read.
    vi.advanceTimersByTime(61_000);
    const replacement = await cachedQueryPartition(TABLE, 'record_type', 'contract');

    // The first read only fails now, after its entry was already replaced.
    failFirst(new Error('late'));
    expect(await guarded).toBe('failed');

    expect(replacement).toEqual(ITEMS);
    // The live entry survived the late failure — this read is still cached.
    await cachedQueryPartition(TABLE, 'record_type', 'contract');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('clears every entry on reset', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: ITEMS })
      .mockResolvedValueOnce({ Items: ITEMS });

    await cachedQueryPartition(TABLE, 'record_type', 'contract');
    __resetPartitionCache();
    await cachedQueryPartition(TABLE, 'record_type', 'contract');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
