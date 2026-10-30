import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { leaseHoldersOn, onSQLite, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausedASecond = workflow('do:\n  - pause: { wait: PT1S }');

describe('a host opened whole', () => {
  it('opens its parts, takes the claim, wakes them by its loop and lets go of the claim when it stops', async () => {
    const clock = steppedClock(Date.now());
    const settings = await onSQLite();
    const hosted = await hostedOn(settings, { clock, holder: 'whole', sweepEveryMs: 1000 });
    hosted.know(runId);
    const leases = await openedOn(settings);
    const holdersWhileOpen = await leaseHoldersOn(leases);

    const started = await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausedASecond)));
    clock.step(1000);
    const settled = await until(hosted.settlements, (settlements) => settlements.size > 0);
    await hosted.host.stop();

    expect([holdersWhileOpen, started, [...settled.keys()], await leaseHoldersOn(leases)]).toEqual([
      ['whole'],
      'started',
      [runId],
      [],
    ]);
  });
});
