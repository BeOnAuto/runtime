import { Effect, Fiber, Layer, Result, Schema } from 'effect';
import { TestClock, TestConsole } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  ActedContextSchema,
  CallLineage,
  type Decider,
  defineCommand,
  factOf,
  IncidentReporter,
  makeDispatcher,
  messageIdOf,
  type Outcome,
  PlaybookWriter,
  TriggerKindSchema,
} from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';
import { memoryLedger, memoryPlaybookRegistry } from '../testing/index.ts';
import { breakAndGiveUp, explode, misreport, overshare, rejectUndeclared } from '../testing/misbehaving.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const incidentId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const callOnAlpha = { operation: 'explode', org: 'acme', playbook: 'alpha', caller: 'acme-admin' };

function explodingWith(report: IncidentReporter['Service']['report']) {
  const services = Layer.mergeAll(
    memoryLedger().layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    Layer.succeed(IncidentReporter, IncidentReporter.of({ report })),
    TestClock.layer(),
    TestConsole.layer,
  );
  const watched = Effect.gen(function* () {
    const call = yield* Effect.forkChild(
      makeDispatcher([]).dispatchToPlaybook(explode.registration, toAlpha(acmeAdmin)),
    );
    yield* TestClock.adjust('2 seconds');
    const outcome: Outcome = yield* Fiber.join(call);
    return { incident: incidentOf(outcome), logged: (yield* TestConsole.logLines).join(' ') };
  });
  return Effect.runPromise(watched.pipe(Effect.provide(services)));
}

function incidentOf(outcome: Outcome): string {
  return 'incident' in outcome ? outcome.incident : `no incident in ${outcome.status}`;
}

describe('a defect in a call', () => {
  it('becomes an incident whose original and call go to the reporter only', async () => {
    const { dispatcher, reported, run } = harness();

    const outcome = await run(dispatcher.dispatchToPlaybook(explode.registration, toAlpha(acmeAdmin)));

    expect(outcome).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported()[0]?.id).toMatch(incidentId);
    expect(reported()).toEqual([
      { id: reported()[0]?.id, original: new Error('the store password is hunter2'), call: callOnAlpha },
    ]);
  });

  it('includes output that breaks or exceeds the output schema', async () => {
    const { dispatcher, reported, run } = harness();

    const misreported = await run(dispatcher.dispatchToOrg(misreport.registration, toOrg('acme')(acmeAdmin)));
    const overshared = await run(dispatcher.dispatchToPlaybook(overshare.registration, toAlpha(acmeAdmin)));

    expect([misreported, overshared]).toEqual(reported().map(({ id }) => ({ status: 'failed', incident: id })));
    expect(reported()[0]?.call).toEqual({ operation: 'misreport', org: 'acme', caller: 'acme-admin' });
  });

  it('includes a rejection the handler did not declare', async () => {
    const { dispatcher, reported, run } = harness();

    expect(await run(dispatcher.dispatchToPlaybook(rejectUndeclared.registration, toAlpha(acmeAdmin)))).toMatchObject({
      status: 'failed',
    });
    expect(reported().map(({ original }) => original)).toMatchObject([{ detail: 'taken' }]);
  });

  it('includes a defect beside an interruption', async () => {
    const { dispatcher, reported, run } = harness();

    expect(await run(dispatcher.dispatchToPlaybook(breakAndGiveUp.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'failed',
      incident: reported()[0]?.id,
    });
  });
});

describe('the incident reporter', () => {
  it('is given two seconds, after which the incident id is logged and the call still fails', async () => {
    const { incident, logged } = await explodingWith(() => Effect.never);

    expect(incident).toMatch(incidentId);
    expect(logged).toContain(`The incident reporter did not record incident ${incident}`);
  });

  it('may fail or throw without changing the outcome, and the incident id is logged', async () => {
    const dying = await explodingWith(() => Effect.die('reporter down'));
    const throwing = await explodingWith(() => {
      throw new Error('reporter threw');
    });

    expect(dying.incident).toMatch(incidentId);
    expect(throwing.incident).toMatch(incidentId);
    expect(dying.logged).toContain(`The incident reporter did not record incident ${dying.incident}`);
    expect(throwing.logged).toContain(`The incident reporter did not record incident ${throwing.incident}`);
  });
});

const NotedSchema = factOf('noted', Schema.Struct({}), ActedContextSchema);

const notes: Decider<null, null, typeof NotedSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: () => Result.succeed([{ type: 'noted', data: {} }]),
  context: () => ({ at: '2026-10-05T09:00:00.000Z', by: 'tester' }),
  eventSchema: NotedSchema,
};

const note = defineCommand('playbook', {
  name: 'note',
  title: 'Note',
  description: 'Notes that it was called, with the lineage the call was given.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({
    version: Schema.Int,
    depth: Schema.Int,
    callDepth: Schema.Int,
    calledBy: Schema.NullOr(Schema.Struct({ run_id: Schema.String, reference: Schema.String, run: Schema.Int })),
    trigger: Schema.NullOr(Schema.Struct({ kind: TriggerKindSchema, reference: Schema.String })),
    actsFor: Schema.NullOr(Schema.String),
    attemptDied: Schema.Boolean,
  }),
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* () {
    const { lineage, depth, callDepth, calledBy, trigger, actsFor, attemptDied } = yield* CallLineage;
    const { version } = yield* (yield* PlaybookWriter).execute('notes', notes, null, lineage ?? undefined);
    return { version, depth, callDepth, calledBy, trigger, actsFor, attemptDied };
  }),
});

describe('the lineage of a call', () => {
  it('reaches a playbook command as a service, which writes it beside its events, and is null when none was given', async () => {
    const { dispatcher, ledger, run } = harness();
    const lineage = { causationId: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3', correlationId: 'root' };
    await run(dispatcher.dispatchToPlaybook(note.registration, { ...toAlpha(acmeAdmin), lineage }));
    await run(dispatcher.dispatchToPlaybook(note.registration, toAlpha(acmeAdmin)));

    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'everything' },
        { order: 'asc', limit: 10 },
      ),
    );

    expect(records.map(({ id, causationId, correlationId }) => ({ id, causationId, correlationId }))).toEqual([
      { id: messageIdOf('playbook/acme/alpha/notes', 1), ...lineage },
      { id: messageIdOf('playbook/acme/alpha/notes', 2), causationId: null, correlationId: null },
    ]);
  });

  it('carries the reaction depth the request was given, and 0 for a request that gave none', async () => {
    const { dispatcher, run } = harness();

    const outcomes = [
      await run(dispatcher.dispatchToPlaybook(note.registration, { ...toAlpha(acmeAdmin), depth: 3 })),
      await run(dispatcher.dispatchToPlaybook(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { version: 1, depth: 3 } },
      { status: 'succeeded', output: { version: 2, depth: 0 } },
    ]);
  });
});

describe('the lineage of a call a workflow made', () => {
  it('carries how many calls are above the run and the call it answers, and none for a request that gave none', async () => {
    const { dispatcher, run } = harness();
    const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/ask', run: 2 };

    const outcomes = [
      await run(dispatcher.dispatchToPlaybook(note.registration, { ...toAlpha(acmeAdmin), callDepth: 2, calledBy })),
      await run(dispatcher.dispatchToPlaybook(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toEqual([
      {
        status: 'succeeded',
        output: { version: 1, depth: 0, callDepth: 2, calledBy, trigger: null, actsFor: null, attemptDied: false },
      },
      {
        status: 'succeeded',
        output: {
          version: 2,
          depth: 0,
          callDepth: 0,
          calledBy: null,
          trigger: null,
          actsFor: null,
          attemptDied: false,
        },
      },
    ]);
  });
});

describe('the lineage of a run a trigger started', () => {
  it('carries the trigger that started the run, and none for a request that gave none', async () => {
    const { dispatcher, run } = harness();
    const trigger = { kind: 'every' as const, reference: '/schedule/every' };

    const outcomes = [
      await run(dispatcher.dispatchToPlaybook(note.registration, { ...toAlpha(acmeAdmin), trigger })),
      await run(dispatcher.dispatchToPlaybook(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { version: 1, trigger } },
      { status: 'succeeded', output: { version: 2, trigger: null } },
    ]);
  });
});

describe('the lineage of a run that acts for a person', () => {
  it('carries the person the run acts for, and none for a request that gave none', async () => {
    const { dispatcher, run } = harness();

    const outcomes = [
      await run(dispatcher.dispatchToPlaybook(note.registration, { ...toAlpha(acmeAdmin), actsFor: 'person:ada' })),
      await run(dispatcher.dispatchToPlaybook(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { version: 1, actsFor: 'person:ada' } },
      { status: 'succeeded', output: { version: 2, actsFor: null } },
    ]);
  });
});

describe('the lineage of a call made again', () => {
  it('says the caller knows the attempt it made of the run before died, and says nothing of it otherwise', async () => {
    const { dispatcher, run } = harness();

    const outcomes = [
      await run(dispatcher.dispatchToPlaybook(note.registration, { ...toAlpha(acmeAdmin), attemptDied: true })),
      await run(dispatcher.dispatchToPlaybook(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { version: 1, attemptDied: true } },
      { status: 'succeeded', output: { version: 2, attemptDied: false } },
    ]);
  });
});
