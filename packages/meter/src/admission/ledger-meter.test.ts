import { RunMeter } from '@on.auto/definitions';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountServiceLayer } from '../accounts/fetched-account-service.ts';
import { RuntimeLicense } from '../licensing/runtime-license.ts';
import { ledgerMeter } from '../licensing/self-hosted-meter.ts';
import { meterBehaviour } from '../meter-testing/meter-behaviour.ts';
import { memoryLedgerAt } from '../testing/memory-ledger.ts';
import { runOf } from '../testing/runs.ts';
import { meterDefaults } from './metering.ts';

const noNetwork = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

meterBehaviour('a ledger in memory', () => Promise.resolve(memoryLedgerAt()));

describe('the meter of every runtime', () => {
  it('admits 100 first runs without a key, then 15 a UTC day and 75 a UTC month, holds an admission ten minutes and links Auto’s Studio', () => {
    expect(meterDefaults).toEqual({
      allowance: 100,
      freeRate: { per_day: 15, per_month: 75 },
      holdMs: 600_000,
      studio: 'https://studio.on.auto',
    });
  });

  it('is the run meter of a layer over the ledger and the account service, with the free runs it ships with', async () => {
    const account = accountServiceLayer({ origin: 'https://accounts.example.com', fetch: noNetwork });
    const runtime = ManagedRuntime.make(
      ledgerMeter().pipe(Layer.provide(memoryLedgerAt().layer()), Layer.provide(account)),
    );
    onTestFinished(() => runtime.dispose());
    const admitted = Effect.flatMap(Effect.service(RunMeter), (meter) => meter.admit(runOf('run-1')));

    await expect(runtime.runPromise(admitted)).resolves.toBeUndefined();
    expect(
      (await runtime.runPromise(Effect.flatMap(Effect.service(RuntimeLicense), ({ status }) => status))).free_runs,
    ).toEqual({ used: 1, of: meterDefaults.allowance });
  });
});
