import { setImmediate } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { controlledWork } from './control-work.ts';

describe('license requests during server shutdown', () => {
  it('rejects new operations and joins both successful and failed requests before storage closes', async () => {
    const work = controlledWork();
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<never>();
    const success = work.run(() => first.promise);
    const failure = work.run(() => second.promise).catch(() => 'failed');
    let closed = false;
    const stopping = work.stop().then(() => {
      closed = true;
      return true;
    });
    await expect(work.run(() => Promise.resolve('unexpected'))).rejects.toThrow('runtime_meter_stopping');
    first.resolve('saved');
    expect(await success).toBe('saved');
    await setImmediate();
    expect(closed).toBe(false);
    second.reject(new Error('failed'));
    expect(await failure).toBe('failed');
    await stopping;
    expect(closed).toBe(true);
    await work.stop();
  });
});
