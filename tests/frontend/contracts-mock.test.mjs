import { describe, expect, it, vi } from 'vitest';
import { fetchApi } from '../../src/lib/api.mjs';
import { mockContractsResponse } from '../../src/lib/contracts-mock.mjs';

describe('local contracts mock', () => {
  it('serves mockup contract data in development without calling the API', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(fetchApi('/contracts')).resolves.toBe(mockContractsResponse);
    expect(fetch).not.toHaveBeenCalled();
    expect(mockContractsResponse.contracts).toHaveLength(4);
    expect(mockContractsResponse.postures).toHaveLength(5);

    vi.unstubAllGlobals();
  });
});