import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { leftUnread } from './content-intake.ts';

describe('a content left unread', () => {
  it('cancels its stream, so its source stops making the bytes no one reads', async () => {
    const cancelled = Promise.withResolvers<unknown>();
    const stream = new ReadableStream<Uint8Array>({
      cancel: (reason) => {
        cancelled.resolve(reason);
      },
    });

    await Effect.runPromise(leftUnread(stream));

    await expect(cancelled.promise).resolves.toBeUndefined();
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined });
  });
});
