import { statement } from '@on.auto/ledger';
import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { selfHostedRuns } from '../index.ts';
import { assertOfflineConservation } from '../offline-testing/fixture.ts';
import { dispatchRequest, runtimeFixture, source } from '../runtime-testing/fixture.ts';

describe('recovery at the reservation boundary', () => {
  it('recovers a reservation committed before its reply was lost', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const runs = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          reserve: async (request) => {
            await f.meter.accounting.reserve(request);
            throw new Error('lost reservation reply');
          },
        },
      },
    });
    expect(await f.runtimeWith(runs).run()).toMatchObject({ status: 'succeeded' });
    expect(await runs.reconcile({ reader: f.database.ledger })).toMatchObject({ settled: 1 });
    expect(f.dispatched).toHaveLength(1);
    await assertOfflineConservation(f.options.connection);
  });

  it('does not dispatch if a committed reservation cannot be read back', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const runs = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          reservation: () => Effect.runPromise(Effect.undefined),
        },
      },
    });
    expect(await f.runtimeWith(runs).run()).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(f.dispatched).toEqual([]);
    expect((await f.meter.capacity())?.counters).toMatchObject([{ reservedUnits: 1_000_000n, committedUnits: 0n }]);
    expect(await f.reconcile()).toMatchObject({ settled: 1, failed: 0 });
    expect((await f.meter.capacity())?.counters).toMatchObject([{ reservedUnits: 0n, committedUnits: 0n }]);
  });
});

describe('recovery at the dispatch boundary', () => {
  it('releases a held credit only after Runtime records that dispatch failed', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const runs = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          commitDispatch: () => Promise.reject(new Error('private storage error')),
        },
      },
    });
    const result = await f.runtimeWith(runs).run();
    expect(result).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private storage error');
    expect(f.dispatched).toEqual([]);
    expect(await f.reconcile()).toMatchObject({ settled: 1, failed: 0 });
    expect((await f.meter.capacity())?.counters).toMatchObject([{ reservedUnits: 0n, committedUnits: 0n }]);
    await assertOfflineConservation(f.options.connection);
  });

  it('keeps the dispatch charge when the computation fails after admission', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    expect(
      await f.runtime.update(
        source.replace('return { doubled: input.value * 2 };', 'throw new Error("failed computation");'),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.runtime.run()).toMatchObject({ status: 'rejected' });
    expect(f.dispatched).toHaveLength(1);
    expect(await f.reconcile()).toMatchObject({ settled: 1, failed: 0 });
    expect((await f.meter.capacity())?.counters).toMatchObject([{ reservedUnits: 0n, committedUnits: 1_000_000n }]);
  });
});

describe('current license and available credit', () => {
  it('uses only the five allocated credits and gives a useful refusal for the sixth run', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const results = await Promise.all(Array.from({ length: 6 }, () => f.runtime.run(crypto.randomUUID())));
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: 'conflict' }]);
    expect(f.dispatched).toHaveLength(5);
    expect(await f.reconcile()).toMatchObject({ inspected: 5, settled: 5, failed: 0 });
    await assertOfflineConservation(f.options.connection);
  });

  it('refuses absent allocations and revoked licenses without dispatching', async () => {
    const f = await runtimeFixture();
    f.state.allocations = [];
    await f.meter.license.activate('activation-secret');
    const allocation = await Effect.runPromise(Effect.flip(f.runs.admission.dispatch(dispatchRequest())));
    expect(allocation).toBeInstanceOf(Conflict);
    expect(allocation.detail).toContain('Allocate credits');
    f.authority.state.challengeStatus = 401;
    await expect(f.meter.license.refresh()).rejects.toThrow('license_service_refused');
    const revoked = await Effect.runPromise(Effect.flip(f.runs.admission.dispatch(dispatchRequest())));
    expect(revoked).toBeInstanceOf(Conflict);
    expect(revoked.detail).toContain('no longer authorizes');
    expect(f.dispatched).toEqual([]);
  });
});

describe('authority failures before reserve', () => {
  it('rechecks trusted time after reading the current license', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const runs = selfHostedRuns({
      ...f.runOptions,
      meter: { ...f.meter, time: async () => ({ ...(await f.meter.time()), onlineRequired: true }) },
    });
    const refused = await Effect.runPromise(Effect.flip(runs.admission.dispatch(dispatchRequest())));
    expect(refused).toBeInstanceOf(Conflict);
    expect(refused.detail).toContain('verify its license time');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_reservations`)).toEqual([]);
  });

  it('sanitizes non-Error failures from dependencies', async () => {
    const f = await runtimeFixture();
    const runs = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        license: {
          ...f.meter.license,
          head: () => {
            const failure = Promise.withResolvers<never>();
            failure.reject('private failure');
            return failure.promise;
          },
        },
      },
    });
    const refused = await Effect.runPromise(Effect.flip(runs.admission.dispatch(dispatchRequest())));
    expect(refused).toBeInstanceOf(Unavailable);
    expect(refused.detail).not.toContain('private failure');
  });
});
