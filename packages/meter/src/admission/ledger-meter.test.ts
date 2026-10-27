import { RunMeter } from '@on.auto/definitions';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { postgresqlLedger, sqliteLedger } from '../testing/ledgers.ts';
import { meterBehaviour } from '../testing/meter-behaviour.ts';
import { runOf } from '../testing/metered.ts';
import { opened, startedOnceAdmitted } from '../testing/opened.ts';
import { ledgerMeter, meterDefaults } from './ledger-meter.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const onSQLite = () => Promise.resolve(sqliteLedger());

meterBehaviour('SQLite', onSQLite);

describe.skipIf(server === '')('with PostgreSQL', () => {
  meterBehaviour('PostgreSQL', () => postgresqlLedger(server));
});

describe('the meter of every runtime', () => {
  it('admits 100 actions before a license, holds an admission ten minutes, verifies every 1,000 and links Auto’s Studio', () => {
    expect(meterDefaults).toEqual({
      allowance: 100,
      holdMs: 600_000,
      verifyEvery: 1000,
      studio: 'https://studio.on.auto',
    });
  });

  it('is the run meter of a layer over the ledger', async () => {
    const at = sqliteLedger();
    onTestFinished(() => at.remove());
    const runtime = ManagedRuntime.make(ledgerMeter().pipe(Layer.provide(at.layer())));
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

  it('faults when an event after its checkpoint can no longer be read, rather than skip it', async () => {
    const { metered, tampering } = await opened(onSQLite);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    await metered.started('run-2');
    const [started = ''] = await tampering.idsOf('playbook/acme/alpha/runs/run-2');
    await tampering.garbled(started);

    expect((await metered.admitted(runOf('run-3'))).kind).toBe('metering_fault');
    expect(await metered.state()).toMatchObject({ fault: { reason: 'unreadable' } });
  });
});
