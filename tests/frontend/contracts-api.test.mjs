import { describe, expect, it, vi } from 'vitest';
import { fetchApi } from '../../src/lib/api.mjs';

describe('contracts API client', () => {
  it('fetches contracts from the standard API endpoint', async () => {
    const payload = {
      contracts: [],
      postures: [],
      population: { state: 'complete', captured_at: null, row_count: 0 },
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);

    try {
      await expect(fetchApi('/contracts')).resolves.toEqual(payload);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('/api/contracts', { credentials: 'include' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
