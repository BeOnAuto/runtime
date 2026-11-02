import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { abortedWith, connectionFailure, jsonResponse } from '../provider-testing/recording-fetch.ts';
import { heard, onTheClock, relayed, voiceOf, type Answering } from '../provider-testing/voice-calls.ts';

const failingFirst: Answering = (_sent, attempt) =>
  attempt === 1 ? jsonResponse({}, 408) : jsonResponse({ text: 'second time' });

describe('a transcription tried again', () => {
  it('is tried twice more after 2 and then 4 seconds where the provider is unavailable', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({ error: { message: 'overloaded' } }, 503));

    const { sentBy, result } = await onTheClock(voice, sent, [0, 1999, 2000, 5999, 6000]);

    expect(sentBy).toEqual([
      [0, 1],
      [1999, 1],
      [2000, 2],
      [5999, 2],
      [6000, 3],
    ]);
    expect(result).toMatchObject({ failure: { _tag: 'provider_unavailable', status: 503 } });
  });

  it('answers from the attempt that succeeds', async () => {
    const { voice, sent } = await voiceOf(relayed, failingFirst);

    const { result } = await onTheClock(voice, sent, [0, 2000]);

    expect(result).toEqual(Result.succeed({ text: 'second time', cost_usd: null }));
  });
});

describe('the wait before a transcription is tried again', () => {
  it('is as long as the provider asks where that is less than a minute', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({}, 429, { 'retry-after': '1' }));

    const { sentBy, result } = await onTheClock(voice, sent, [0, 999, 1000, 1999, 2000]);

    expect(sentBy.map(([, count]) => count)).toEqual([1, 1, 2, 2, 3]);
    expect(result).toMatchObject({ failure: { _tag: 'rate_limited', retry_after_ms: 1000 } });
  });

  it('is 2 and then 4 seconds where the provider asks for a minute or more', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({}, 429, { 'retry-after': '120' }));

    const { sentBy } = await onTheClock(voice, sent, [0, 1999, 2000, 6000]);

    expect(sentBy.map(([, count]) => count)).toEqual([1, 1, 2, 3]);
  });

  it('is tried again where the provider cannot be reached', async () => {
    const { voice, sent } = await voiceOf(relayed, () => connectionFailure('ECONNREFUSED'));

    const { result } = await onTheClock(voice, sent, [0, 2000, 6000]);

    expect(sent()).toHaveLength(3);
    expect(result).toMatchObject({
      failure: { _tag: 'provider_unavailable', detail: 'relay could not be reached', status: null },
    });
  });
});

describe('a transcription not tried again', () => {
  it('fails where the certificate of the provider is not trusted, and the operator is told what to add', async () => {
    const { voice, sent, hints } = await voiceOf(relayed, () => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN'));

    expect(await heard(voice)).toMatchObject({
      failure: {
        _tag: 'provider_not_configured',
        detail:
          'The TLS certificate of relay is not trusted by this server; its operator must add the certificate authority',
      },
    });
    expect(sent()).toHaveLength(1);
    expect(hints()).toEqual([
      {
        provider: 'relay',
        model: 'relay/xai/scribe_v2',
        hint: 'The TLS certificate of relay is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
        run_id: null,
      },
    ]);
  });

  it('times out 60 seconds after it was first sent, every attempt included, and the call is cut off', async () => {
    const { voice, sent } = await voiceOf(relayed, ({ signal }) => abortedWith(signal));

    const { sentBy, result } = await onTheClock(voice, sent, [0, 59_999, 60_000]);

    expect(sentBy.map(([, count]) => count)).toEqual([1, 1, 1]);
    expect(result).toMatchObject({
      failure: { _tag: 'timed_out', detail: 'relay did not answer within 60000 ms', timeout_ms: 60_000 },
    });
    expect(sent()[0]?.signal.aborted).toBe(true);
  });
});
