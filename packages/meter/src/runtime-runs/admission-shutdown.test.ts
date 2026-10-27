import { setImmediate } from 'node:timers/promises';

import { statement } from '@on.auto/ledger';
import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { selfHostedRuns } from '../index.ts';
import { dispatchRequest, runtimeFixture } from '../runtime-testing/fixture.ts';

describe('stopping during durable admission', () => {
  it('joins the accounting transaction before interruption can close its database', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const started = Promise.withResolvers<true>();
    const proceed = Promise.withResolvers<true>();
    const runs = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          commitDispatch: async (request) => {
            started.resolve(true);
            await proceed.promise;
            return f.meter.accounting.commitDispatch(request);
          },
        },
      },
    });
    const fiber = Effect.runFork(runs.admission.dispatch(dispatchRequest()));
    await started.promise;
    let stopped = false;
    const stopping = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      stopped = true;
      return true;
    });
    await setImmediate();
    expect(stopped).toBe(false);
    proceed.resolve(true);
    await stopping;
    expect(stopped).toBe(true);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(1);
  });
});
