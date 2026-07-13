import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Node 18+ provides Blob globally; ensure it exists for the sendBeacon path.
import { Blob } from 'buffer';
vi.stubGlobal('Blob', Blob);

let sendBeacon;
let fetchMock;

beforeEach(async () => {
  sendBeacon = vi.fn().mockReturnValue(true);
  fetchMock = vi.fn().mockResolvedValue({});
  vi.stubGlobal('navigator', { sendBeacon });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { origin: 'https://hub.example', pathname: '/skills/foo' } });
  vi.stubGlobal('document', { referrer: '' });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function load() {
  return import('../../src/lib/usage.mjs');
}

describe('track', () => {
  it('sends via sendBeacon to /api/hub-log and does not fall back to fetch', async () => {
    const { track } = await load();
    track('page_view', { path: '/x' });
    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/hub-log');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to keepalive fetch when sendBeacon returns false', async () => {
    sendBeacon.mockReturnValue(false);
    const { track } = await load();
    track('page_view', { path: '/x' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/hub-log');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    expect(JSON.parse(opts.body)).toEqual({ event: 'page_view', props: { path: '/x' } });
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const { track } = await load();
    track('filter_applied', { filter_name: 'source', filter_value: 'all' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('never throws when the transport throws', async () => {
    sendBeacon.mockImplementation(() => { throw new Error('boom'); });
    const { track } = await load();
    expect(() => track('page_view', {})).not.toThrow();
  });

  it('swallows a rejected fetch', async () => {
    sendBeacon.mockReturnValue(false);
    fetchMock.mockRejectedValue(new Error('network'));
    const { track } = await load();
    expect(() => track('page_view', {})).not.toThrow();
  });
});

describe('referrerSource', () => {
  it('returns direct when there is no referrer', async () => {
    const { referrerSource } = await load();
    expect(referrerSource()).toBe('direct');
  });

  it('returns browse for a same-origin referrer', async () => {
    vi.stubGlobal('document', { referrer: 'https://hub.example/skills' });
    const { referrerSource } = await load();
    expect(referrerSource()).toBe('browse');
  });

  it('returns direct for a cross-origin referrer', async () => {
    vi.stubGlobal('document', { referrer: 'https://google.com/search' });
    const { referrerSource } = await load();
    expect(referrerSource()).toBe('direct');
  });
});

describe('trackPageView', () => {
  it('fires page_view with the current path and referrer', async () => {
    vi.stubGlobal('document', { referrer: 'https://hub.example/' });
    const { trackPageView } = await load();
    trackPageView();
    const blobSent = sendBeacon.mock.calls[0][1];
    expect(blobSent).toBeInstanceOf(Blob);
    // Decode the beacon body to assert the payload.
    const text = await blobSent.text();
    expect(JSON.parse(text)).toEqual({
      event: 'page_view',
      props: { path: '/skills/foo', referrer: 'https://hub.example/' },
    });
  });
});

describe('debounce', () => {
  it('fires once after the quiet period with the latest args', async () => {
    vi.useFakeTimers();
    const { debounce } = await load();
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d('a'); d('b'); d('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('c');
  });
});
