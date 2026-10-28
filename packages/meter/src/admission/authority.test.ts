import { RunMeter } from '@on.auto/definitions';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { admitting, authorityAnswering, cloudMetered } from '../meter-testing/cloud-metered.ts';
import { sqliteLedger } from '../testing/ledgers.ts';
import { runOf } from '../testing/runs.ts';
import type { AuthorityAnswer } from './authority.ts';
import { ledgerMeterAdmittedBy } from './ledger-meter.ts';

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

describe('a meter whose authority refuses an action with the case and where to resolve it', () => {
  it('refuses with the case the authority names and where it says a person resolves it', async () => {
    const refusing = authorityAnswering(() =>
      Promise.resolve<AuthorityAnswer>({
        admitted: false,
        kind: 'credits_exhausted',
        detail: 'The org acme has used its free runs for the day',
        because: 'free_daily_limit',
        resolve_at: 'https://studio.on.auto/billing?org=acme',
      }),
    );

    expect(await (await cloudMetered(refusing)).admitted('run-1')).toEqual({
      kind: 'credits_exhausted',
      detail: 'The org acme has used its free runs for the day',
      because: 'free_daily_limit',
      resolve_at: 'https://studio.on.auto/billing?org=acme',
    });
  });
});
