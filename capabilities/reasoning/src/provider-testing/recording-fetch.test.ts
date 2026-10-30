import { describe, expect, it } from 'vitest';

import { jsonResponse, recordingFetch } from './recording-fetch.ts';

describe('recordingFetch', () => {
  it('records a request made without options', async () => {
    const recording = recordingFetch(() => jsonResponse({ ok: true }));

    const response = await recording.fetch('https://example.com/health');

    const [request] = recording.requests();
    expect(await response.json()).toEqual({ ok: true });
    expect(request).toMatchObject({ url: 'https://example.com/health', method: 'GET', headers: {}, body: undefined });
    expect(request?.signal.aborted).toBe(false);
  });

  it('records only string headers and a string body', async () => {
    const recording = recordingFetch(() => jsonResponse({}));

    await recording.fetch('https://example.com', {
      method: 'POST',
      headers: { 'X-One': '1', 'x-two': 2 },
      body: new Uint8Array(),
    });

    expect(recording.requests()[0]).toMatchObject({ method: 'POST', headers: { 'x-one': '1' }, body: undefined });
  });

  it('ignores headers that are not an object', async () => {
    const recording = recordingFetch(() => jsonResponse({}));

    await recording.fetch('https://example.com', { headers: 'nope' });

    expect(recording.requests()[0]?.headers).toEqual({});
  });
});
