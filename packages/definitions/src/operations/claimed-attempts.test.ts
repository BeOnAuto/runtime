import { CallLineage, defineCommand, PlaybookWriter, type StreamWriter } from '@on.auto/operations';
import { Cause, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { attemptEnded, nextAttemptOf, type Capability } from '../index.ts';
import { linksIn } from '../journal-testing/run-links.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { acted, askedOfTheRun, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { answeredFirstCall } from '../testing/shell-drives.ts';

const succeeded = { output: { driven: true }, record: {} };

function outcomeOf<A, E, R>(ending: Effect.Effect<A, E, R>): Effect.Effect<string, never, R> {
  return Effect.matchCause(ending, {
    onSuccess: () => 'ended',
    onFailure: (cause) => (Cause.hasDies(cause) ? 'died' : 'refused'),
  });
}

function nextOf(capability: Capability, id: string) {
  return nextAttemptOf([capability], capability, id);
}

function afterTheDeadAttempt<A, E, R>(next: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const lineage = yield* CallLineage;
    return yield* next.pipe(Effect.provideService(CallLineage, { ...lineage, attemptDied: true }));
  });
}

function drivingTwice(capability: Capability) {
  return defineCommand('playbook', {
    name: 'drive_twice',
    title: 'Drive twice',
    description: 'Two shells ask for the next attempt of one run, one after the other.',
    route: { method: 'POST', path: '/drive-twice' },
    inputSchema: Schema.Struct({ run_id: Schema.String }),
    outputSchema: Schema.Struct({ second: Schema.String, first: Schema.String }),
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    handle: ({ run_id: id }) =>
      Effect.gen(function* () {
        const first = yield* nextOf(capability, id);
        const second = yield* outcomeOf(nextOf(capability, id));
        if (first.type !== 'attempt') {
          return { second, first: first.type };
        }
        const ran = Effect.as(first.attempt.context.journal.record(answeredFirstCall), succeeded);
        return { second, first: yield* outcomeOf(attemptEnded(first.attempt, ran)) };
      }),
  });
}

function overtakenOnce(id: string) {
  return Effect.gen(function* () {
    const writer = yield* PlaybookWriter;
    const written = { overtaken: false };
    const anotherShellsClaim = Effect.orDie(
      writer.execute(runStreamNameOf(id), runDecider, {
        type: 'resume',
        attempt: 2,
        runId: id,
        by: 'another-shell',
        at: acted.at,
      }),
    );
    const overtaking = Effect.suspend(() => {
      const first = !written.overtaken;
      written.overtaken = true;
      return first ? Effect.asVoid(anotherShellsClaim) : Effect.void;
    });
    const execute: StreamWriter['execute'] = (stream, decider, command, lineage) =>
      Effect.andThen(overtaking, writer.execute(stream, decider, command, lineage));
    return { execute };
  });
}

function overtakenWhileItReads(capability: Capability) {
  return defineCommand('playbook', {
    name: 'drive_overtaken',
    title: 'Drive overtaken',
    description: 'A shell asks for the next attempt while another claims it after its read, before its own claim.',
    route: { method: 'POST', path: '/drive-overtaken' },
    inputSchema: Schema.Struct({ run_id: Schema.String }),
    outputSchema: Schema.Struct({ next: Schema.String }),
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    handle: ({ run_id: id }) =>
      Effect.gen(function* () {
        const overtaking = yield* overtakenOnce(id);
        return {
          next: yield* outcomeOf(nextOf(capability, id).pipe(Effect.provideService(PlaybookWriter, overtaking))),
        };
      }),
  });
}

function drivenByThree(capability: Capability) {
  return defineCommand('playbook', {
    name: 'drive_three',
    title: 'Drive three',
    description: 'Three shells take the attempt of one run in turn, each told the one before died.',
    route: { method: 'POST', path: '/drive-three' },
    inputSchema: Schema.Struct({ run_id: Schema.String }),
    outputSchema: Schema.Struct({ endings: Schema.Array(Schema.String) }),
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
    handle: ({ run_id: id }) =>
      Effect.gen(function* () {
        const first = yield* nextOf(capability, id);
        const second = yield* afterTheDeadAttempt(nextOf(capability, id));
        const third = yield* afterTheDeadAttempt(nextOf(capability, id));
        if (first.type !== 'attempt' || second.type !== 'attempt' || third.type !== 'attempt') {
          return { endings: [first.type, second.type, third.type] };
        }
        const thirdRan = Effect.as(third.attempt.context.journal.record(answeredFirstCall), succeeded);
        return {
          endings: [
            yield* outcomeOf(attemptEnded(first.attempt, Effect.die('The first shell went away'))),
            yield* outcomeOf(attemptEnded(second.attempt, Effect.succeed(succeeded))),
            yield* outcomeOf(attemptEnded(third.attempt, thirdRan)),
          ],
        };
      }),
  });
}

async function aRunLeft() {
  const started = await startedAndLeft();
  const { capability } = started.resuming;
  const asked = askedOfTheRun;
  const types = async () => (await linksIn(started)).map(({ type }) => type);
  return { started, capability, asked, types };
}

describe('two shells that ask for the next attempt of one run', () => {
  it('give it to the first, which claims it, and refuse the second there as still running, so the run ends once', async () => {
    const { started, capability, asked, types } = await aRunLeft();

    const outcome = await started.call(drivingTwice(capability), asked, momentAfter(quietMs + 1));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { second: 'refused', first: 'ended' } });
    expect(await types()).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'model_call_answered',
      'run_succeeded',
    ]);
  });

  it('refuse the one whose read another claim overtook, appending nothing of its own', async () => {
    const { started, capability, asked, types } = await aRunLeft();

    const outcome = await started.call(overtakenWhileItReads(capability), asked, momentAfter(quietMs + 1));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { next: 'refused' } });
    expect(await types()).toEqual(['run_started', 'model_call_started', 'attempt_resumed']);
  });
});

describe('an attempt whose run a later attempt claimed', () => {
  it('records no ending, whether its drive dies or succeeds, and the attempt that holds the run ends it once', async () => {
    const { started, capability, asked, types } = await aRunLeft();

    const outcome = await started.call(drivenByThree(capability), asked, momentAfter(quietMs + 1));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { endings: ['died', 'refused', 'ended'] } });
    expect(await types()).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'attempt_resumed',
      'attempt_resumed',
      'model_call_answered',
      'run_succeeded',
    ]);
  });
});
