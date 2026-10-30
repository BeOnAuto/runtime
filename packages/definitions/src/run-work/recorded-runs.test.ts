import type { StreamWriter } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookBoundSettler, recordedRunIn, recordedRunInPlaybook, runEventOf } from '../index.ts';
import { asked, askedRun as run, askedRunId, attempted, question } from '../testing/asked-runs.ts';
import { askedRequest } from '../testing/asking.ts';

describe('a run as it was recorded', () => {
  it('is read by its address or by its id in its playbook, and is nothing for a run there is not', async () => {
    const { ledger } = await asked();
    const read = await Effect.runPromise(recordedRunIn(ledger.service, run));

    expect(read).toMatchObject({
      run: { run_id: askedRunId, status: 'started', record: { ...askedRequest, message: question } },
      input: { campaign: 'Spring' },
      awaitsSettlement: true,
      work: [],
      answer: null,
      depth: 0,
      callDepth: 0,
    });
    expect(
      await Effect.runPromise(
        recordedRunInPlaybook(
          { load: (relative, decider) => ledger.service.load(`playbook/acme/alpha/${relative}`, decider) },
          askedRunId.toUpperCase(),
        ),
      ),
    ).toEqual(read);
    expect(await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: 'not-a-run' }))).toBeUndefined();
    expect(
      await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' })),
    ).toBeUndefined();
    expect(runEventOf({ type: 'run_failed', data: { incident: 1 } })).toBeUndefined();
  });
});

describe('a settlement made through the writer of a playbook', () => {
  it('settles a run of that playbook by its id, and finds no run under an id that is not one', async () => {
    const { ledger } = await asked();
    const writer: StreamWriter = {
      execute: (relative, decider, command, given) =>
        ledger.service.execute(`playbook/acme/alpha/${relative}`, decider, command, given),
    };
    const settle = playbookBoundSettler(writer);

    expect(
      await Effect.runPromise(settle(run, { status: 'succeeded', output: { choice: 'approve' }, by: 'acme-admin' })),
    ).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(await attempted(settle({ ...run, id: 'nope' }, { status: 'failed' }))).toMatchObject(
      Result.fail({ _tag: 'not_found' }),
    );
  });
});
