import { describe, expect, it } from 'vitest';

import { observations, retryAfterMsOf } from './observed-requests.ts';

const call = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search' } };

const answeredWith = (headers: Readonly<Record<string, string>> = {}, status = 200) =>
  new Response(null, { status, headers });

describe('the requests a client observes', () => {
  it('pairs a request sent under a marker with the HTTP answer to it', () => {
    const observed = observations('x-request-id', 1024);
    const marker = observed.mark();

    observed.noteSent(call, { onresumptiontoken: marker });
    observed.noteAnswered(JSON.stringify(call), answeredWith({ 'retry-after': '2', 'x-request-id': 'r-1' }, 429));

    expect(observed.take(marker)).toEqual({
      id: 7,
      response: { retryAfterMs: 2000, serverRequestId: 'r-1', tooLarge: false },
    });
    expect(observed.take(marker)).toEqual({ id: null, response: null });
    expect(observed.lastRetryAfterMs()).toBe(2000);
  });

  it('keeps the id of a request no HTTP answer reached, as over stdio', () => {
    const observed = observations('com.example/request_id', 1024);
    const marker = observed.mark();

    observed.noteSent({ ...call, id: 'call-a' }, { onresumptiontoken: marker });

    expect(observed.take(marker)).toEqual({ id: 'call-a', response: null });
  });

  it('keeps nothing of a message sent without a marker, of a message that is not a request, or of an answer to what it did not keep', () => {
    const observed = observations(null, 1024);
    const marker = observed.mark();

    observed.noteSent(call, {});
    observed.noteSent({ jsonrpc: '2.0', id: 8, result: {} }, { onresumptiontoken: marker });
    observed.noteSent({ jsonrpc: '2.0', method: 'notifications/initialized' }, { onresumptiontoken: marker });
    observed.noteAnswered(null, answeredWith());
    observed.noteAnswered(JSON.stringify(call), answeredWith({ 'x-request-id': 'r-2' }));

    expect(observed.take(marker)).toEqual({ id: null, response: null });
    expect(observed.lastRetryAfterMs()).toBeNull();
  });
});

describe('the size of an HTTP answer', () => {
  it('passes an answer within the bound through whole', async () => {
    const observed = observations(null, 4);
    const marker = observed.mark();
    observed.noteSent(call, { onresumptiontoken: marker });

    const answer = observed.noteAnswered(JSON.stringify(call), new Response('four'));

    await expect(answer.text()).resolves.toBe('four');
    expect(observed.take(marker)).toMatchObject({ response: { tooLarge: false } });
  });

  it('stops an answer past the bound, says so of its request, and stops the call that waits for it', async () => {
    const observed = observations(null, 4);
    const marker = observed.mark();
    const stopped: string[] = [];
    observed.noteSent(call, { onresumptiontoken: marker });
    observed.whenTooLarge(marker, () => {
      stopped.push('stopped');
    });

    const answer = observed.noteAnswered(JSON.stringify(call), new Response('fives'));

    await expect(answer.text()).rejects.toThrow('The answer takes more than the 4 bytes it may take');
    expect(stopped).toEqual(['stopped']);
    expect(observed.take(marker)).toMatchObject({ response: { tooLarge: true } });
  });
});

describe('the size of an HTTP answer to one of several requests', () => {
  it('stops only the call whose answer passed the bound', async () => {
    const observed = observations(null, 4);
    const [first, second] = [observed.mark(), observed.mark()];
    const stopped: string[] = [];
    observed.noteSent(call, { onresumptiontoken: first });
    observed.noteSent({ ...call, id: 8 }, { onresumptiontoken: second });
    observed.whenTooLarge(first, () => {
      stopped.push('first');
    });
    observed.whenTooLarge(second, () => {
      stopped.push('second');
    });

    await expect(
      observed.noteAnswered(JSON.stringify({ ...call, id: 8 }), new Response('fives')).text(),
    ).rejects.toThrow('The answer takes more than the 4 bytes it may take');
    expect(stopped).toEqual(['second']);
  });

  it('stops an answer past the bound to a request it did not keep, and passes an answer without a body', async () => {
    const observed = observations(null, 4);

    await expect(observed.noteAnswered(null, new Response('fives')).text()).rejects.toThrow(
      'The answer takes more than the 4 bytes it may take',
    );
    expect(observed.noteAnswered(null, new Response(null, { status: 202 })).status).toBe(202);
  });
});

describe('Retry-After', () => {
  const now = Date.parse('2026-10-05T09:00:00.000Z');

  it('reads seconds written in digits alone, as HTTP writes them', () => {
    expect([retryAfterMsOf('15', now), retryAfterMsOf(' 0 ', now)]).toEqual([15_000, 0]);
  });

  it('reads no wait longer than a day, however many digits or however far the date', () => {
    expect([
      retryAfterMsOf('9'.repeat(20), now),
      retryAfterMsOf('9'.repeat(309), now),
      retryAfterMsOf('Fri, 05 Oct 2096 09:00:00 GMT', now),
    ]).toEqual([86_400_000, 86_400_000, 86_400_000]);
  });

  it('reads a date, never in the past', () => {
    expect(retryAfterMsOf('Mon, 05 Oct 2026 09:00:04 GMT', now)).toBe(4000);
    expect(retryAfterMsOf('Mon, 05 Oct 2026 08:00:00 GMT', now)).toBe(0);
  });

  it('reads nothing from what is missing, blank or neither', () => {
    expect(retryAfterMsOf(null, now)).toBeNull();
    expect(retryAfterMsOf('  ', now)).toBeNull();
    expect(retryAfterMsOf('soon', now)).toBeNull();
  });

  it('reads nothing from seconds in another notation, a fraction or below none', () => {
    expect(['0x10', '1e3', '1.5', '-3'].map((value) => retryAfterMsOf(value, now))).toEqual([null, null, null, null]);
  });
});
