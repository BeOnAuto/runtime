import { RunMeter } from '@on.auto/definitions';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountServiceLayer } from '../accounts/fetched-account-service.ts';
import { ledgerMeter } from '../licensing/self-hosted-meter.ts';
import { meterBehaviour } from '../meter-testing/meter-behaviour.ts';
import { opened } from '../meter-testing/opened.ts';
import { postgresqlLedger, sqliteLedger } from '../testing/ledgers.ts';
import { runOf } from '../testing/runs.ts';
import { meterDefaults } from './metering.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const onSQLite = () => Promise.resolve(sqliteLedger());

const noNetwork = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

meterBehaviour('SQLite', onSQLite);

describe.skipIf(server === '')('with PostgreSQL', () => {
  meterBehaviour('PostgreSQL', () => postgresqlLedger(server));
});

describe('the meter of every runtime', () => {
  it('admits 100 first runs without a key, then 15 a UTC day and 75 a UTC month, holds an admission ten minutes and links Auto’s Studio', () => {
    expect(meterDefaults).toEqual({
      allowance: 100,
      freeRate: { per_day: 15, per_month: 75 },
      holdMs: 600_000,
      studio: 'https://studio.on.auto',
    });
  });

  it('is the run meter of a layer over the ledger and the account service', async () => {
    const at = sqliteLedger();
    onTestFinished(() => at.remove());
    const account = accountServiceLayer({ origin: 'https://accounts.example.com', fetch: noNetwork });
    const runtime = ManagedRuntime.make(ledgerMeter().pipe(Layer.provide(at.layer()), Layer.provide(account)));
    onTestFinished(() => runtime.dispose());
    const admitted = Effect.flatMap(Effect.service(RunMeter), (meter) => meter.admit(runOf('run-1')));

    await expect(runtime.runPromise(admitted)).resolves.toBeUndefined();
  });

  it('refuses as meter_unavailable when the change that admits a run keeps losing to others', async () => {
    const { metered } = await opened(onSQLite);
    metered.executesFail('conflict');

    expect((await metered.admitted(runOf('run-1'))).kind).toBe('meter_unavailable');
  });

  it('refuses as meter_unavailable when its ledger breaks while it admits a run', async () => {
    const { metered } = await opened(onSQLite);
    metered.executesFail('defect');

    expect((await metered.admitted(runOf('run-1'))).kind).toBe('meter_unavailable');
  });

  it('never stops for an event of the history of its runs that can no longer be read', async () => {
    const { metered, tampering } = await opened(onSQLite);
    await metered.admitted(runOf('run-1'));
    await metered.started('run-1');
    const [started = ''] = await tampering.idsOf('playbook/acme/alpha/runs/run-1');
    await tampering.garbled(started);

    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect((await metered.state()).admitted.actions).toBe(2);
  });
});
