import { describe, expect, it } from 'vitest';

import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { heard, relayed, voiceOf } from '../provider-testing/voice-calls.ts';

const outOfCredits = {
  type: 'credits_exhausted',
  code: 'credits_exhausted',
  message: 'This organization has no credits left',
  resolve_at: 'https://studio.example.com/billing',
  because: 'none_left',
};

describe('a transcription the account refuses', () => {
  it('fails as the account said, once, with where it is resolved and why, and tells the operator nothing', async () => {
    const { voice, sent, reports } = await voiceOf(relayed, () => jsonResponse({ error: outOfCredits }, 402));

    expect(await heard(voice)).toMatchObject({
      failure: {
        _tag: 'account_refused',
        kind: 'credits_exhausted',
        detail: 'This organization has no credits left',
        resolve_at: 'https://studio.example.com/billing',
        because: 'none_left',
      },
    });
    expect(sent()).toHaveLength(1);
    expect(reports()).toEqual([]);
  });

  it('keeps no why it does not know, nor a place where it names none', async () => {
    const { voice } = await voiceOf(relayed, () =>
      jsonResponse({ error: { type: 'meter_unavailable', message: 'Try again shortly', because: 'whim' } }, 402),
    );

    const result = await heard(voice);

    expect(result).toMatchObject({
      failure: { _tag: 'account_refused', kind: 'meter_unavailable', detail: 'Try again shortly' },
    });
    expect(result).not.toHaveProperty('failure.because');
    expect(result).not.toHaveProperty('failure.resolve_at');
  });

  it('is the gateway unable to serve it, tried once, where a 402 names no refusal of the account', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({ error: { message: 'Out of funds' } }, 402));

    expect(await heard(voice)).toMatchObject({
      failure: { _tag: 'provider_unavailable', status: 402, detail: 'relay could not serve the request (HTTP 402)' },
    });
    expect(sent()).toHaveLength(1);
  });
});
