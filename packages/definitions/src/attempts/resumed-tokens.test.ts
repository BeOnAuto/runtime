import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { toPlaybook } from '../testing/harness.ts';
import { aProcess } from '../testing/held-attempts.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { drivingAShell } from '../testing/shell-drives.ts';
import { LiveAttempts } from './live-attempts.ts';

describe('the next attempt of a run that resumes, claimed by a shell', () => {
  it('tells the shell the token it holds the run by, the one after the attempt that died', async () => {
    const started = await startedAndLeft();
    const drive = drivingAShell([started.resuming.capability], started.resuming.capability);
    const shell = aProcess();
    const request = toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: acted.runId });

    const driven = await started.run(
      started.dispatch(drive, request).pipe(Effect.provideService(LiveAttempts, shell.live)),
      momentAfter(quietMs + 1),
    );

    expect(driven).toMatchObject({ status: 'succeeded', output: { next: 'attempt', status: 'succeeded' } });
    expect(shell.acquired()).toBe(2);
  });
});

describe("the attempt of a run that resumes, made by a workflow's call under its id once the attempt before died", () => {
  it('tells the shell the token it goes on under, that of the attempt it takes over, since it claims none', async () => {
    const started = await startedAndLeft();
    const shell = aProcess();

    const resumed = await started.run(
      started.askedByACall(true).pipe(Effect.provideService(LiveAttempts, shell.live)),
      momentAfter(1),
    );

    expect(resumed).toMatchObject({ status: 'succeeded' });
    expect(shell.acquired()).toBe(1);
  });
});
