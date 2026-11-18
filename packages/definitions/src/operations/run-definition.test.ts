import {
  CallLineage,
  type CallLink,
  defineCommand,
  type IncidentReporter,
  playbookCallerOf,
  PlaybookWriter,
  type StreamWriter,
} from '@on.auto/operations';
import { Cause, Deferred, Effect, Fiber, Schema, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { LiveAttempts, liveAttemptsLayer, liveAttemptsOf, type RunRefusal } from '../attempts/live-attempts.ts';
import { attemptEnded, type Capability, defineStartVersion, nextAttemptOf } from '../index.ts';
import { linksIn } from '../journal-testing/run-links.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { startedRunOf } from '../runs/run-state.ts';
import type { RunDetail } from '../runs/run.ts';
import { asking } from '../testing/asking.ts';
import { acmeAdmin, adaOfAcme, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { quietMs, resumer } from '../testing/capabilities/resumer.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { aProcess } from '../testing/held-attempts.ts';
import {
  acted,
  askedOfTheRun,
  heldAfterItsCall,
  momentAfter,
  startedAndLeft,
  stream,
} from '../testing/resumed-runs.ts';
import { testRunId } from '../testing/run-facts.ts';
import { answeredFirstCall, drivingAShell } from '../testing/shell-drives.ts';

const { createDefinition, runDefinition, getRun, updateDefinition } = definitionOperationsFor([
  echo,
  probe().capability,
]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const greeted = {
  run_id: runId,
  type: 'echo',
  name: 'greet',
  definition_version: 1,
  status: 'succeeded',
  output: { greeting: 'Hello', input: {} },
  started_at: firstMoment,
  started_by: { id: 'acme-admin', name: 'acme-admin' },
  finished_at: firstMoment,
};

async function withGreetAndPlain() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }));
  return definitions;
}

function running(name: string, input?: object) {
  const type = name === 'greet' ? 'echo' : 'probe';
  return toAlpha(acmeAdmin, input === undefined ? { type, name } : { type, name, ...input });
}

function bothArrived() {
  const arrived = { count: 0 };
  const together = Deferred.makeUnsafe<true>();
  return Effect.suspend(() => {
    arrived.count += 1;
    return arrived.count === 2 ? Deferred.succeed(together, true) : Deferred.await(together);
  });
}

function noticingTheSecond(
  arrival: Effect.Effect<boolean>,
): Effect.Effect<LiveAttempts['Service'], never, Scope.Scope | IncidentReporter> {
  const seen = { count: 0 };
  return Effect.map(liveAttemptsOf<RunDetail, RunRefusal>(), (live) => ({
    attempt: live.attempt,
    interrupt: live.interrupt,
    close: live.close,
    acquired: live.acquired,
    outliving: (key, run) =>
      Effect.suspend(() => {
        seen.count += 1;
        return seen.count === 2 ? Effect.andThen(arrival, live.outliving(key, run)) : live.outliving(key, run);
      }),
  }));
}

const thePlaybook = playbookCallerOf({ org: 'acme', playbook: 'alpha' });

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
    const execute: StreamWriter['execute'] = (streamClaimedAttempts, decider, command, lineage) =>
      Effect.andThen(overtaking, writer.execute(streamClaimedAttempts, decider, command, lineage));
    return { ...writer, execute };
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

const someWords: unknown = expect.any(String);

const startOfAnEcho = {
  type: 'start',
  started_by: recordedAdmin,
  definition_type: 'echo',
  name: 'step',
  input: {},
  definition_version: 1,
  calls_tools: false,
  ...acted,
  at: firstMoment,
} as const;

describe('run_definition', () => {
  it('runs a definition with an input and answers with the run it recorded under a new id', async () => {
    const { call, ledger } = await withGreetAndPlain();

    const outcome = await call(runDefinition, running('greet', { input: { who: 'Ada' } }), later);
    const [, , runStream] = ledger.streamNames();
    const id = String(runStream).replace('playbook/acme/alpha/runs/', '');

    expect(id).toMatch(uuidV7);
    expect(outcome).toStrictEqual({
      status: 'succeeded',
      output: {
        run_id: id,
        type: 'echo',
        name: 'greet',
        definition_version: 1,
        status: 'succeeded',
        output: { greeting: 'Hello', input: { who: 'Ada' } },
        started_at: later,
        started_by: { id: 'acme-admin', name: 'acme-admin' },
        finished_at: later,
        record: { greeting: 'Hello' },
      },
    });
  });

  it('answers with the run that get_run reads, its record included', async () => {
    const { call } = await withGreetAndPlain();
    const ran = await call(runDefinition, running('greet', { run_id: runId }));

    expect(ran).toStrictEqual({ status: 'succeeded', output: { ...greeted, record: { greeting: 'Hello' } } });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toStrictEqual(ran);
  });
});

describe('who started a run', () => {
  it('is the caller who started it, a person by their id and their name, as get_run reads it', async () => {
    const { call } = await withGreetAndPlain();
    await call(runDefinition, toAlpha(adaOfAcme, { type: 'echo', name: 'greet', run_id: runId }));

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      output: { started_by: { id: 'person:user_2ada', name: 'Ada Lovelace' } },
    });
  });
});

describe('the run that run_definition runs', () => {
  it('gives the capability an empty object when the input is left out', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('greet'))).toMatchObject({
      output: { output: { greeting: 'Hello', input: {} } },
    });
  });

  it('tells the capability the run id, the org, the playbook, the caller and the definition it runs', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('plain', { input: 7, run_id: runId }))).toMatchObject({
      output: {
        output: {
          input: 7,
          run: {
            id: runId,
            org: 'acme',
            playbook: 'alpha',
            caller: acmeAdmin,
            definition: { name: 'plain', version: 1 },
          },
        },
      },
    });
  });

  it('runs the active latest version of the definition', async () => {
    const { call } = await withGreetAndPlain();
    await call(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Howdy"}' }));

    expect(await call(runDefinition, running('greet'))).toMatchObject({
      output: { definition_version: 2, output: { greeting: 'Howdy' } },
    });
  });

  it('keeps the run id it is given, in lowercase', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('greet', { run_id: runId.toUpperCase() }))).toMatchObject({
      output: { run_id: runId },
    });
  });
});

describe('run_definition rejected by the capability', () => {
  it('for invalid input, with the issues under /input, and records the rejection', async () => {
    const { call } = await withGreetAndPlain();

    expect(await call(runDefinition, running('plain', { input: { reject: true }, run_id: runId }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The probe rejects the input',
      issues: [{ detail: 'Expected anything but reject', pointer: '/input/reject' }],
    });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toStrictEqual({
      status: 'succeeded',
      output: {
        run_id: runId,
        type: 'probe',
        name: 'plain',
        definition_version: 1,
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          detail: 'The probe rejects the input',
          issues: [{ detail: 'Expected anything but reject', pointer: '/input/reject' }],
        },
        started_at: firstMoment,
        started_by: { id: 'acme-admin', name: 'acme-admin' },
        finished_at: firstMoment,
      },
    });
  });

  it('for input that is not what the capability takes at its root', async () => {
    const { call } = await withGreetAndPlain();
    const notAnObject = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input of an echo definition must be a JSON object',
      issues: [{ detail: 'Expected a JSON object', pointer: '/input' }],
    };

    expect(await call(runDefinition, running('greet', { input: 'Ada' }))).toEqual(notAnObject);
    expect(await call(runDefinition, running('greet', { input: ['Ada'] }))).toEqual(notAnObject);
  });
});

async function recordedInputOf({ ledger, run }: Harness) {
  const { state } = await run(ledger.service.load(stream, runDecider));
  return startedRunOf(state)?.input;
}

const aWorkflowsCall: CallLink = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/step', run: 1 };

const refusedByTheEcho = { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/input' }] };

describe('an input given as JSON text', () => {
  it('is recorded and run as the value it holds when the input schema of the definition takes it, and asked again as that value is the same run', async () => {
    const definitions = await withGreetAndPlain();

    const asText = await definitions.call(runDefinition, running('greet', { input: '{"who":"Ada"}', run_id: runId }));
    const asTheValue = await definitions.call(
      runDefinition,
      running('greet', { input: { who: 'Ada' }, run_id: runId }),
    );

    expect(asText).toMatchObject({
      status: 'succeeded',
      output: { output: { greeting: 'Hello', input: { who: 'Ada' } } },
    });
    expect(asTheValue).toEqual(asText);
    expect(await recordedInputOf(definitions)).toEqual({ inline: { who: 'Ada' } });
  });

  it('is recorded and run as given in a call a run makes', async () => {
    const definitions = await withGreetAndPlain();

    const called = await definitions.call(runDefinition, {
      ...running('greet', { input: '{"who":"Ada"}', run_id: runId }),
      calledBy: aWorkflowsCall,
    });

    expect(called).toMatchObject(refusedByTheEcho);
    expect(await recordedInputOf(definitions)).toEqual({ inline: '{"who":"Ada"}' });
  });

  it('is run as given when the value it holds is past the bounds of an input, the definition declares no input schema, or there is no such definition', async () => {
    const definitions = await withGreetAndPlain();
    const pastTheBounds = JSON.stringify({ n: Array.from({ length: 50_000 }, () => 1e20) }).replaceAll(
      '100000000000000000000',
      '1e20',
    );

    expect([
      await definitions.call(runDefinition, running('greet', { input: pastTheBounds })),
      await definitions.call(runDefinition, running('plain', { input: '{"seats":2}' })),
      await definitions.call(runDefinition, running('absent', { input: '{"seats":2}' })),
    ]).toMatchObject([
      refusedByTheEcho,
      { status: 'succeeded', output: { output: { input: '{"seats":2}' } } },
      { status: 'rejected', reason: 'not_found' },
    ]);
  });
});

describe('two attempts of a run that resumes, made at once by callers that each think the attempt before died', () => {
  it('never run at once: the one whose call is recorded second records nothing and says the run is still running', async () => {
    const definitions = await startedAndLeft({ beforeItsCall: bothArrived(), afterItsCall: Effect.sleep('1 second') });

    const { first, both } = await definitions.run(
      Effect.gen(function* () {
        const one = yield* Effect.forkChild(definitions.asking(true));
        const other = yield* Effect.forkChild(definitions.asking(true));
        const ended = yield* Effect.raceFirst(Fiber.join(one), Fiber.join(other));
        yield* TestClock.adjust('1 second');
        return { first: ended, both: [yield* Fiber.join(one), yield* Fiber.join(other)] };
      }),
      momentAfter(1000),
    );

    expect(first).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'taken' });
    expect(both.map(({ status }) => status).toSorted((one, other) => one.localeCompare(other))).toEqual([
      'rejected',
      'succeeded',
    ]);
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_succeeded',
    ]);
  });
});

describe('two attempts of a run that resumes, made at once by callers that each think the attempt before died, each starting a tool call', () => {
  it('never both start it: the one whose start is recorded second records nothing and says the run is still running', async () => {
    const definitions = await startedAndLeft({
      beforeItsCall: bothArrived(),
      afterItsCall: Effect.sleep('1 second'),
      startsAToolCall: true,
    });

    const both = await definitions.run(
      Effect.gen(function* () {
        const one = yield* Effect.forkChild(definitions.asking(true));
        const other = yield* Effect.forkChild(definitions.asking(true));
        yield* Effect.raceFirst(Fiber.join(one), Fiber.join(other));
        yield* TestClock.adjust('1 second');
        return [yield* Fiber.join(one), yield* Fiber.join(other)];
      }),
      momentAfter(1000),
    );

    expect(both.map(({ status }) => status).toSorted((one, other) => one.localeCompare(other))).toEqual([
      'rejected',
      'succeeded',
    ]);
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'tool_call_started',
      'run_succeeded',
    ]);
  });
});

describe('a request for a run whose attempt is live in this process', () => {
  it('waits for that attempt and answers what it answers, so a retry is answered once', async () => {
    const called = Deferred.makeUnsafe<true>();
    const arrived = Deferred.makeUnsafe<true>();
    const definitions = await startedAndLeft({
      afterItsCall: Effect.andThen(Deferred.succeed(called, true), Effect.sleep('1 second')),
    });

    const answers = await definitions.run(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(definitions.asking());
        yield* Deferred.await(called);
        const retry = yield* Effect.forkChild(definitions.asking());
        yield* Deferred.await(arrived);
        yield* TestClock.adjust('1 second');
        return [yield* Fiber.join(first), yield* Fiber.join(retry)];
      }).pipe(
        Effect.provideServiceEffect(LiveAttempts, noticingTheSecond(Deferred.succeed(arrived, true))),
        Effect.scoped,
      ),
      momentAfter(quietMs + 1),
    );

    expect(answers.map(({ status }) => status)).toEqual(['succeeded', 'succeeded']);
    expect(answers[1]).toEqual(answers[0]);
    expect(definitions.resuming.contexts()).toHaveLength(1);
  });
});

describe('an attempt of a run of a capability that does not resume', () => {
  it('is made in the call of its caller, the attempts live in the process keeping it once', async () => {
    const { createDefinition: createDefinitionCallAttempts, runDefinition: runDefinitionCallAttempts } =
      definitionOperationsFor([echo]);
    const { dispatch, run: within, call } = harness();
    const toAlphaCallAttempts = toPlaybook('acme', 'alpha');
    await call(
      createDefinitionCallAttempts,
      toAlphaCallAttempts(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
    );
    const asked = toAlphaCallAttempts(acmeAdmin, { type: 'echo', name: 'greet', input: {}, run_id: testRunId });

    const answers = await within(
      Effect.all([dispatch(runDefinitionCallAttempts, asked), dispatch(runDefinitionCallAttempts, asked)], {
        concurrency: 'unbounded',
      }).pipe(Effect.provide(liveAttemptsLayer)),
    );

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { status: 'succeeded' } },
      { status: 'succeeded', output: { status: 'succeeded' } },
    ]);
  });
});

describe("an attempt of a run of a capability that resumes, asked by a workflow's call", () => {
  it('is made in that call: stopped with it, as by a host that stands by, it records no ending, and the next perform goes on with it', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({ afterItsCall: held.afterItsCall });

    const resumed = await definitions.run(
      Effect.gen(function* () {
        const call = yield* Effect.forkChild(definitions.askedByACall(true));
        yield* Deferred.await(held.called);
        yield* Fiber.interrupt(call);
        yield* Deferred.succeed(held.released, true);
        return yield* definitions.askedByACall(true);
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect(resumed).toMatchObject({ status: 'succeeded' });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'model_call_started',
      'run_succeeded',
    ]);
    expect(definitions.resuming.contexts()).toHaveLength(2);
  });
});

describe('a start once whose run finishes later, in a process that keeps its live attempts', () => {
  it('is made outside them, since only its settlement ends it, while one of the same definition that answers in its call is made inside', async () => {
    const definitions = harness();
    const { createDefinition: creatingAQuestion } = definitionOperationsFor([asking]);
    await definitions.call(
      creatingAQuestion,
      toAlpha(acmeAdmin, { type: 'asking', name: 'approve', source: 'Approve?' }),
    );
    const startingAQuestion = defineStartVersion([asking]);
    const keys: string[] = [];
    const shell = aProcess();
    const live = LiveAttempts.of({
      ...shell.live,
      attempt: (key, run) =>
        Effect.suspend(() => {
          keys.push(key);
          return shell.live.attempt(key, run);
        }),
    });
    const startOnce = (input: object, id: string) =>
      definitions.run(
        definitions
          .dispatch(
            startingAQuestion,
            toAlpha(thePlaybook, { type: 'asking', name: 'approve', version: 1, input, run_id: id }),
          )
          .pipe(Effect.provideService(LiveAttempts, live)),
      );
    const answeredLater = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';
    const answeredNow = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

    const laterStartVersionAttempts = await startOnce({}, answeredLater);
    const now = await startOnce({ now: true }, answeredNow);

    expect([laterStartVersionAttempts, now]).toMatchObject([
      { status: 'succeeded', output: { status: 'started' } },
      { status: 'succeeded', output: { status: 'succeeded' } },
    ]);
    expect(keys).toEqual([`acme/alpha/${answeredNow}`]);
  });
});

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
  it('records no ending where its drive dies, and its result where its drive succeeds before the later one started a call, so the run ends once', async () => {
    const { started, capability, asked, types } = await aRunLeft();

    const outcome = await started.call(drivenByThree(capability), asked, momentAfter(quietMs + 1));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { endings: ['died', 'ended', 'ended'] } });
    expect(await types()).toEqual([
      'run_started',
      'model_call_started',
      'attempt_resumed',
      'attempt_resumed',
      'attempt_resumed',
      'run_succeeded',
    ]);
  });
});

describe('the next attempt of a started run of another type than the capability a shell gives', () => {
  it("is refused as run_definition refuses it, though a definition of that capability has the run's name, and records nothing", async () => {
    const resuming = resumer();
    const operations = definitionOperationsFor([resuming.capability, echo]);
    const definitions = harness();
    const created = (type: string, source: string) =>
      definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type, name: 'step', source }));
    await created('echo', '{"greeting":"hello"}');
    await created('resumer', 'resumer source');
    await definitions.run(Effect.orDie(definitions.ledger.service.execute(stream, runDecider, startOfAnEcho)));
    const drive = drivingAShell([resuming.capability, echo], resuming.capability);

    const driven = await definitions.call(drive, toAlpha(acmeAdmin, { run_id: acted.runId }), momentAfter(quietMs + 1));
    const { version } = await definitions.run(definitions.ledger.service.load(stream, runDecider));

    expect(driven).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: someWords,
    });
    expect(version).toBe(1);
  });
});
