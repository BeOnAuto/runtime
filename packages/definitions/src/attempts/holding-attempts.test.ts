import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { quietMs } from '../testing/capabilities/resumer.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { deadAttemptEnder, holdingAttemptIn } from './index.ts';

const run = { org: 'acme', playbook: 'alpha', id: acted.runId };

describe('the attempt that holds a run, as the run reads', () => {
  it('names its token and what its start recorded of whom the run is for and how it goes on', async () => {
    const started = await startedAndLeft();

    expect(
      await Effect.runPromise(holdingAttemptIn(started.ledger.service, { ...run, id: run.id.toUpperCase() })),
    ).toEqual({
      fencingToken: 1,
      type: 'resumer',
      startedBy: 'acme-admin',
      resumes: true,
      calledBy: null,
      trigger: null,
      actsFor: null,
      depth: 0,
      callDepth: 0,
    });
  });

  it('is nothing for a run that ended, one there is not, or an address no playbook holds', async () => {
    const started = await startedAndLeft();
    await started.running(momentAfter(quietMs + 1));
    const holding = (address: Readonly<typeof run>) =>
      Effect.runPromise(holdingAttemptIn(started.ledger.service, address));

    expect([
      await holding(run),
      await holding({ ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' }),
      await holding({ ...run, id: 'not-a-run' }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the attempt that holds a run that resumes, named dead by a shell that makes no next attempt of it', () => {
  it('is ended, as the attempt of a run within its call is, while a shell that would resume it is told so', async () => {
    const started = await startedAndLeft();
    const lineage = { causationId: null, correlationId: run.id };
    const ender = deadAttemptEnder(started.ledger.service);

    const resumedElsewhere = await Effect.runPromise(ender({ run, lineage, fencingToken: 1 }));
    const ended = await Effect.runPromise(ender({ run, lineage, fencingToken: 1, noNextAttempt: true }));

    expect([resumedElsewhere, ended]).toEqual(['outlives_its_call', 'ended']);
    expect(await Effect.runPromise(holdingAttemptIn(started.ledger.service, run))).toBeUndefined();
  });
});
