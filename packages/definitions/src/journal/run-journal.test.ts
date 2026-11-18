import { Caller, PlaybookContext, PlaybookReader, PlaybookWriter, playbookLedgerOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Context, Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent, modelCallTimedOut } from '../journal-testing/model-calls.ts';
import { idAt, journalled, journalledStream, linksIn } from '../journal-testing/run-links.ts';
import type { ModelCallFact, RunCommand } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { answerOfCall, startOfCall, toolUser } from '../testing/capabilities/tool-user.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, runStreamIn, toPlaybook } from '../testing/harness.ts';
import { testRunId as runId } from '../testing/run-facts.ts';
import { runJournal } from './run-journal.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const toAlpha = toPlaybook('acme', 'alpha');

const runIdRunJournal = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const at = { runId: runIdRunJournal, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const typesOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }) }),
);

async function playbookWithToolUser() {
  const user = toolUser();
  const operations = definitionOperationsFor([user.capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', source: 'x' }),
  );
  const running = (input: object) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', input, run_id: runIdRunJournal }),
    );
  const history = async () =>
    typesOf(
      await definitions.call(operations.getRunHistory, toAlpha(acmeAdmin, { run_id: runIdRunJournal, limit: 100 })),
    ).output.events.map(({ type }) => type);
  const recordedDirectly = (...commands: readonly RunCommand[]) =>
    definitions.run(
      Effect.forEach(commands, (command) =>
        Effect.orDie(
          definitions.ledger.service.execute(
            runStreamIn(definitions.ledger, { type: 'tool-user', name: 'caller' }, runIdRunJournal),
            runDecider,
            command,
          ),
        ),
      ),
    );
  return { ...definitions, ...operations, user, running, history, recordedDirectly };
}

const calls = (count: number, type: string): readonly string[] => Array.from({ length: count }, () => type);

const diskFull = () => Effect.die(new Error('The disk is full'));

function modelCalled(number: number): ModelCallFact {
  return { type: 'model_call_started', data: { number, ...modelCallSent() } };
}

const takenSecond: unknown = expect.objectContaining({ _tag: 'conflict', kind: 'taken' });

describe('the journal of a run', () => {
  it('records ten calls made at once, one append at a time, each start before its answer', async () => {
    const { running, history, user } = await playbookWithToolUser();

    expect(await running({ calls: 10 })).toMatchObject({
      status: 'succeeded',
      output: { output: { recorded: Array.from({ length: 20 }, () => true) } },
    });
    expect(await history()).toEqual([
      'run_started',
      ...calls(10, 'tool_call_started'),
      ...calls(10, 'tool_call_answered'),
      'run_succeeded',
    ]);
    expect(user.capability.describeOutput({ recorded: [] })).toBe('It called its tools.');
  });

  it('numbers the calls made at once in the order their starts land, each from the run, never twice', async () => {
    const { call, running, getRunHistory } = await playbookWithToolUser();
    await running({ calls: 10 });

    const read = await call(getRunHistory, toAlpha(acmeAdmin, { run_id: runIdRunJournal, limit: 100 }));
    const { events } = Schema.decodeUnknownSync(
      Schema.Struct({
        output: Schema.Struct({
          events: Schema.Array(
            Schema.Struct({ type: Schema.String, data: Schema.Struct({ number: Schema.optionalKey(Schema.Int) }) }),
          ),
        }),
      }),
    )(read).output;

    expect(events.filter(({ type }) => type === 'tool_call_started').map(({ data }) => data.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });
});

describe('the journal of a run whose calls failed', () => {
  it('records how each call failed after its start', async () => {
    const { running, history } = await playbookWithToolUser();
    await running({ calls: 1, failing: true });

    expect(await history()).toEqual(['run_started', 'tool_call_started', 'tool_call_failed', 'run_succeeded']);
  });
});

describe('the journal of a run that has finished', () => {
  it('records nothing more', async () => {
    const { running, history, user } = await playbookWithToolUser();
    await running({ calls: 1 });

    expect(await user.recordedLate()).toEqual([false]);
    expect(await user.startedLate()).toEqual([undefined]);
    expect(await history()).toEqual(['run_started', 'tool_call_started', 'tool_call_answered', 'run_succeeded']);
  });

  it('leaves a call in flight when the run is cancelled with a start and no answer', async () => {
    const { callCancelledWhen, runDefinition, history, user } = await playbookWithToolUser();
    const request = toAlpha(acmeAdmin, {
      type: 'tool-user',
      name: 'caller',
      input: { calls: 1, ending: 'stall' },
      run_id: runIdRunJournal,
    });

    expect(await callCancelledWhen(user.stalled, runDefinition, request)).toEqual({ status: 'cancelled' });
    expect(await user.recordedLate()).toEqual([false]);
    expect(await history()).toEqual(['run_started', 'tool_call_started', 'run_failed']);
  });
});

describe('a run that called tools', () => {
  it.each(['unavailable', 'conflict'])(
    'is not run again under its id after it ended %s, and says to start a new run',
    async (ending) => {
      const { running, user } = await playbookWithToolUser();
      await running({ calls: 1, ending });

      expect(await running({ calls: 1, ending })).toMatchObject({
        status: 'rejected',
        reason: 'conflict',
        kind: 'tools_called',
      });
      expect(await user.recordedLate()).toEqual([false]);
    },
  );

  it('is answered again when it succeeded', async () => {
    const { running, user } = await playbookWithToolUser();
    const first = await running({ calls: 2 });

    expect(await running({ calls: 2 })).toEqual(first);
    expect(await user.recordedLate()).toEqual([false]);
  });

  it('left started by a server that died stays started, is listed as running, and is not run again', async () => {
    const { call, running, getRun, listRuns, recordedDirectly } = await playbookWithToolUser();
    await recordedDirectly(
      {
        type: 'start',
        started_by: recordedAdmin,
        playbook: 'alpha',
        definition_type: 'tool-user',
        name: 'caller',
        input: {},
        definition_version: 1,
        calls_tools: true,
        ...at,
      },
      { type: 'call', fact: { type: 'tool_call_started', data: startOfCall(1) }, fencingToken: 1, ...at },
    );

    expect(await running({})).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runIdRunJournal }))).toMatchObject({
      output: { status: 'started' },
    });
    expect(await call(listRuns, toAlpha(acmeAdmin, { status: 'started' }))).toMatchObject({
      output: { runs: [{ run_id: runIdRunJournal, status: 'started' }] },
    });
  });
});

describe('a run of a definition that calls tools, still in progress', () => {
  it('is not run again under its id while an earlier call still runs it, before any tool was called', async () => {
    const { callCancelledWhen, runDefinition, running, history, user } = await playbookWithToolUser();
    const first = toAlpha(acmeAdmin, {
      type: 'tool-user',
      name: 'caller',
      input: { calls: 0, ending: 'stall' },
      run_id: runIdRunJournal,
    });
    const retried = user.stalled.then(() => running({ calls: 0, ending: 'stall' }));

    expect(await callCancelledWhen(retried, runDefinition, first)).toEqual({ status: 'cancelled' });
    expect(await retried).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(await history()).toEqual(['run_started', 'run_failed']);
  });
});

describe('the journal of an attempt, given the end of a call an attempt before it started', () => {
  it('links the end to where its attempt began, knowing no start of the call', async () => {
    const definitions = harness();
    const startedBefore = definitions.ledger.service.execute(journalledStream, runDecider, {
      type: 'call',
      fact: { type: 'tool_call_started', data: startOfCall(1) },
      fencingToken: 1,
      runId,
      by: 'acme-admin',
      at: '2026-10-01T09:00:01.000Z',
    });

    expect(
      await journalled(definitions, (journal) =>
        Effect.andThen(Effect.orDie(startedBefore), journal.ended(1, answerOfCall(1))),
      ),
    ).toBe(true);
    expect((await linksIn(definitions)).at(-1)).toEqual({
      type: 'tool_call_answered',
      id: idAt(definitions, 3),
      causationId: idAt(definitions, 1),
      correlationId: runId,
    });
  });
});

describe('a fact the ledger cannot write', () => {
  it('fails the step that writes it as a defect, never as a call another attempt took', async () => {
    const failing = Effect.gen(function* () {
      const journal = yield* runJournal(
        '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        { startId: 'start', correlationId: 'run' },
        { startedAt: '2026-10-01T09:00:00.000Z', modelCallsBefore: 0, calls: [] },
        1,
      );
      return yield* journal.record({ type: 'model_call_started', data: { number: 1, ...modelCallSent() } });
    }).pipe(
      Effect.provideService(PlaybookReader, {
        ...Context.get(playbookLedgerOf(memoryLedger().service, alpha), PlaybookReader),
        definitionHolding: () => Effect.succeed('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8ca1'),
      }),
      Effect.provideService(PlaybookWriter, {
        execute: diskFull,
        keepContent: diskFull,
        ofDefinition: () => ({ execute: diskFull }),
      }),
      Effect.provideService(Caller, acmeAdmin),
      Effect.provideService(PlaybookContext, alpha),
    );

    const exit = await Effect.runPromiseExit(failing);

    expect([Exit.hasDies(exit), Exit.hasFails(exit)]).toEqual([true, false]);
  });
});

describe('the journal of a run that calls its model', () => {
  it('links each model call to the answer before it and its answer or failure to it, a tool call asked for to that answer, and the finish to the last', async () => {
    const definitions = harness();
    const recorded = await journalled(definitions, (journal) =>
      Effect.orDie(
        Effect.all([
          journal.record(modelCalled(1)),
          journal.record({ type: 'model_call_answered', data: { number: 1, ...modelCallAnswered() } }),
          journal.started(startOfCall(1)),
          journal.ended(1, answerOfCall(1)),
          journal.record(modelCalled(2)),
          Effect.flip(journal.record(modelCalled(2))),
          journal.record({ type: 'model_call_failed', data: { number: 2, ...modelCallTimedOut } }),
          journal.latest,
        ]),
      ),
    );

    expect(recorded).toEqual([1, 1, 1, true, 2, takenSecond, 2, idAt(definitions, 7)]);
    expect((await linksIn(definitions)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['run_started', null],
      ['model_call_started', idAt(definitions, 1)],
      ['model_call_answered', idAt(definitions, 2)],
      ['tool_call_started', idAt(definitions, 3)],
      ['tool_call_answered', idAt(definitions, 4)],
      ['model_call_started', idAt(definitions, 5)],
      ['model_call_failed', idAt(definitions, 6)],
    ]);
  });
});
