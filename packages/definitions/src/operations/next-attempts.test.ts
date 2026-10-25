import { describe, expect, it } from 'vitest';

import { linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { toPlaybook } from '../testing/harness.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { drivingAShell } from '../testing/shell-drives.ts';

async function aStartedRun() {
  const started = await startedAndLeft();
  const drive = drivingAShell([started.resuming.capability], started.resuming.capability);
  const driven = (at: string, id = acted.runId) =>
    started.call(drive, toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: id }), at);
  return { ...started, driven };
}

describe('the next attempt of a started run, which a shell drives itself', () => {
  it('is the context the resume makes, whose journal records the facts the shell gives it, and ends as run_definition records it', async () => {
    const started = await aStartedRun();

    const outcome = await started.driven(momentAfter(quietMs + 1));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { next: 'attempt', status: 'succeeded' } });
    expect((await linksIn(started)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(started.resuming.contexts()).toEqual([]);
  });

  it('is refused as still running while the run shows a fact within its bound, recording nothing', async () => {
    const started = await aStartedRun();

    expect(await started.driven(momentAfter(quietMs))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
    });
    expect((await linksIn(started)).map(({ type }) => type)).toEqual(['run_started', 'model_call_started']);
  });
});

describe('a run with no attempt for a shell to drive', () => {
  it('answers a run that has ended', async () => {
    const started = await aStartedRun();
    await started.running(momentAfter(quietMs + 1));

    expect(await started.driven(momentAfter(quietMs + 2))).toMatchObject({
      status: 'succeeded',
      output: { next: 'answered', status: 'succeeded' },
    });
  });

  it('ends a run whose cancel was asked as its cancel asks', async () => {
    const started = await aStartedRun();
    await started.run(started.cancelling, momentAfter(1));

    expect(await started.driven(momentAfter(quietMs + 1))).toMatchObject({ status: 'rejected', reason: 'cancelled' });
  });

  it('is not found for an id no run has', async () => {
    const started = await aStartedRun();

    expect(await started.driven(momentAfter(quietMs + 1), '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8bff')).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});
