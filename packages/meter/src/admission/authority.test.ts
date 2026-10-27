import { RunMeter, type MeteredRun } from '@on.auto/definitions';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteLedger, tamperingOn } from '../testing/ledgers.ts';
import { meterRuntimeOn } from '../testing/meter-runtime.ts';
import { answerOf, runOf, runStreamOf, starts } from '../testing/runs.ts';
import type { AdmissionAuthority, AuthorityAnswer } from './authority.ts';
import { ledgerMeterAdmittedBy, meterOver } from './ledger-meter.ts';
import { meterDefaults } from './metering.ts';

interface Asked {
  readonly authority: AdmissionAuthority;
  readonly asked: () => readonly string[];
}

function authorityAnswering(answer: () => Promise<AuthorityAnswer>): Asked {
  const asked: string[] = [];
  return {
    authority: {
      admit: (_run: MeteredRun, action: string) => {
        asked.push(action);
        return answer();
      },
    },
    asked: () => [...asked],
  };
}

const admitting = () => Promise.resolve<AuthorityAnswer>({ admitted: true });

async function cloudMetered({ authority }: Asked) {
  const at = sqliteLedger();
  onTestFinished(() => at.remove());
  const runtime = meterRuntimeOn(at);
  onTestFinished(() => runtime.dispose());
  const meter = await runtime.timed(
    Effect.flatMap(runtime.ledgered, (ledgered) => meterOver(ledgered, meterDefaults, authority)),
  );
  return {
    ...runtime,
    tampering: tamperingOn(at),
    admitted: (run: string) => runtime.timed(answerOf(meter.admit(runOf(run)), 'admitted')),
    started: (run: string) => runtime.onTheLedger((ledger) => ledger.execute(runStreamOf(run), starts, null)),
  };
}

describe('a meter whose authority admits each action, as Auto’s hosting does through its account', () => {
  it('asks the authority for every new action by org, playbook and run id, with no allowance, and keeps its count', async () => {
    const asking = authorityAnswering(admitting);
    const metered = await cloudMetered(asking);
    await metered.admitted('run-1');
    await metered.started('run-1');
    await metered.admitted('Run-1');
    await metered.admitted('run-2');

    expect(asking.asked()).toEqual(['acme/alpha/run-1', 'acme/alpha/run-2']);
    expect(await metered.state()).toMatchObject({ checkpoint: { actions: 1 }, holds: [], installation: undefined });
  });

  it('refuses in the kind and words of the authority, and as meter_unavailable when it cannot be asked', async () => {
    const refusing = authorityAnswering(() =>
      Promise.resolve<AuthorityAnswer>({ admitted: false, kind: 'credits_exhausted', detail: 'No credit is left' }),
    );
    const unreached = authorityAnswering(() => Promise.reject(new Error('The binding is gone')));

    expect(await (await cloudMetered(refusing)).admitted('run-1')).toEqual({
      kind: 'credits_exhausted',
      detail: 'No credit is left',
    });
    expect((await (await cloudMetered(unreached)).admitted('run-1')).kind).toBe('meter_unavailable');
  });

  it('refuses every run, asking nothing, once a fault stands', async () => {
    const asking = authorityAnswering(admitting);
    const metered = await cloudMetered(asking);
    await metered.admitted('run-1');
    await metered.started('run-1');
    await metered.admitted('run-2');
    await metered.tampering.deleted(String((await metered.state()).checkpoint?.last));

    expect((await metered.admitted('run-3')).kind).toBe('metering_fault');
    expect(asking.asked()).toEqual(['acme/alpha/run-1', 'acme/alpha/run-2']);
  });

  it('is the run meter of a layer over the ledger', async () => {
    const at = sqliteLedger();
    onTestFinished(() => at.remove());
    const asking = authorityAnswering(admitting);
    const runtime = ManagedRuntime.make(ledgerMeterAdmittedBy(asking.authority).pipe(Layer.provide(at.layer())));
    onTestFinished(() => runtime.dispose());
    await runtime.runPromise(Effect.flatMap(Effect.service(RunMeter), (meter) => meter.admit(runOf('run-1'))));

    expect(asking.asked()).toEqual(['acme/alpha/run-1']);
  });
});
