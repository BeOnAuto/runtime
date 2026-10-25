import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { attemptEnded, nextAttemptOf, type Capability } from '../index.ts';
import { modelCallAnswered } from '../journal-testing/model-calls.ts';
import { linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { toPlaybook } from '../testing/harness.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';

const answered = { type: 'model_call_answered', data: { number: 1, ...modelCallAnswered(0) } } as const;

function drivingAShell(capability: Capability) {
  return defineCommand('playbook', {
    name: 'drive_run',
    title: 'Drive run',
    description: 'Drives the next attempt of a started run as a shell does, from its facts.',
    route: { method: 'POST', path: '/drive' },
    inputSchema: Schema.Struct({ run_id: Schema.String }),
    outputSchema: Schema.Struct({ next: Schema.String, status: Schema.String }),
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    handle: ({ run_id: id }) =>
      Effect.gen(function* () {
        const next = yield* nextAttemptOf([capability], capability, id);
        if (next.type === 'answered') {
          return { next: next.type, status: next.answer.status };
        }
        const { journal } = next.attempt.context;
        const ended = yield* attemptEnded(
          next.attempt,
          Effect.as(Effect.orDie(journal.record(answered)), { output: { driven: true }, record: {} }),
        );
        return { next: next.type, status: ended.status };
      }),
  });
}

async function aStartedRun() {
  const started = await startedAndLeft();
  const drive = drivingAShell(started.resuming.capability);
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
