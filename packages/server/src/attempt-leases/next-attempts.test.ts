import { echo, recordedAsGiven } from '@on.auto/definitions/testing';
import { Ledger, makeDispatcher, playbookCallerOf, type PlaybookRequest } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineNextAttempt, defineRefusedAttempt } from './next-attempts.ts';

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
  recordingReporter().layer,
);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function asAlphaItself(input: object): PlaybookRequest {
  return {
    caller: playbookCallerOf({ org: 'acme', playbook: 'alpha' }),
    org: 'acme',
    playbook: 'alpha',
    input,
    encoding: 'json',
  };
}

const dispatcher = makeDispatcher([]);

const nextAttempt = defineNextAttempt([echo]);

const refusedAttempt = defineRefusedAttempt([echo]);

type Operation = Pick<typeof nextAttempt, 'registration'>;

function dispatchedIn(operation: Operation, input: object) {
  return dispatcher.dispatchToPlaybook(operation.registration, asAlphaItself(input));
}

function dispatched(operation: Operation, input: object) {
  return Effect.runPromise(dispatchedIn(operation, input).pipe(Effect.provide(services)));
}

describe('the next attempt of a run whose holder is gone, where the server keeps no live attempts', () => {
  it('is made in the call that asks for it, answering a run there is not as not found', async () => {
    expect(await dispatched(nextAttempt, { type: 'echo', run_id: runId })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
    expect(
      await dispatched(refusedAttempt, {
        type: 'echo',
        run_id: runId,
        detail: 'The caller lacks the playbook:write permission',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });

  it('is not found for a type of definition the server does not run', async () => {
    expect(await dispatched(nextAttempt, { type: 'telepathy', run_id: runId })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
      detail: 'This server runs no definition of the type telepathy',
    });
  });
});

describe('the next attempt of a run that has ended', () => {
  it('is no attempt, the run answered as it stands', async () => {
    const at = '2026-11-15T09:00:00.000Z';
    const context = { runId, by: 'playbook:alpha', at, definitionType: 'echo', definitionName: 'greet' };
    const started = { started_by: { id: 'playbook:alpha', name: 'alpha' }, input: {} };
    const ran = Effect.gen(function* () {
      yield* recordedAsGiven(
        yield* Ledger,
        `playbook/acme/alpha/runs/${runId}`,
        [
          { type: 'run_started', data: started },
          { type: 'run_succeeded', data: { output: 'Hello', record: {} } },
        ],
        { ...context, definitionVersion: 1 },
      );
      return yield* dispatchedIn(nextAttempt, { type: 'echo', run_id: runId });
    });

    expect(await Effect.runPromise(ran.pipe(Effect.provide(services)))).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'succeeded', output: 'Hello' },
    });
  });
});
