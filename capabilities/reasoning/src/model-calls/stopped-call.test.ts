import { afterEach, describe, expect, it, vi } from 'vitest';

import { textRequest } from '../testing/adapter-harness.ts';
import { deadlineOf } from './stopped-call.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('the deadline of a model call', () => {
  it('is none for a request that names no time, and the one it is given where it is given one', () => {
    const given = new AbortController().signal;

    expect(deadlineOf(textRequest('openai/gpt-5'))).toBeUndefined();
    expect(deadlineOf(textRequest('openai/gpt-5', { timeout_ms: 300 }), () => given)).toMatchObject({
      signal: given,
      ms: 300,
    });
  });

  it('passes once the time the request names has passed, and never once the call has ended', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const missed = deadlineOf(textRequest('openai/gpt-5', { timeout_ms: 300 }));
    const ended = deadlineOf(textRequest('openai/gpt-5', { timeout_ms: 300 }));
    ended?.ended();

    vi.advanceTimersByTime(299);
    const before = missed?.signal.aborted;
    vi.advanceTimersByTime(1);

    expect([before, missed?.signal.aborted, ended?.signal.aborted]).toEqual([false, true, false]);
  });
});
