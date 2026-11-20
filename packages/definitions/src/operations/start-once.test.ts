import { Ledger, OrgMembership, playbookCallerOf, type PlaybookRequest } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineStartVersion } from '../index.ts';
import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';

const {
  createDefinition,
  getDefinition,
  updateDefinition,
  retireDefinition,
  restoreDefinition,
  resumeDefinition,
  pauseDefinition,
  getRun,
} = definitionOperationsFor([echo]);

const startVersion = defineStartVersion([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const thePlaybook = playbookCallerOf({ org: 'acme', playbook: 'alpha' });

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function starting(version: number, input: object = {}, id = runId) {
  return toAlpha(thePlaybook, { type: 'echo', name: 'greet', version, input, run_id: id });
}

const benOfAcme = { ...adaOfAcme, id: 'person:user_3ben', name: 'Ben Okafor' };

function adaHasLeftAcme(org: string, person: string) {
  return Effect.succeed(org !== 'acme' || person !== adaOfAcme.id);
}

const every = { kind: 'every' as const, reference: '/schedule/every' };

const secondRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

async function savedByAdaThenByAKey() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(adaOfAcme, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await definitions.call(
    updateDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  return definitions;
}

function runRecordsOf(definitions: Harness, id: string) {
  return definitions.run(
    Effect.orDie(
      definitions.ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'run', run: id },
        { order: 'asc', limit: 10 },
      ),
    ),
  );
}

describe('the person a run a trigger starts acts for', () => {
  it('is the person who saved the version it runs, on every fact of the run and in get_run, while the playbook started it', async () => {
    const definitions = await savedByAdaThenByAKey();

    const started = await definitions.call(startVersion, { ...starting(1), trigger: every });
    const { records } = await runRecordsOf(definitions, runId);
    const read = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect(started).toMatchObject({
      status: 'succeeded',
      output: { started_by: { id: 'playbook:alpha', name: 'alpha' }, acts_for: 'person:user_2ada' },
    });
    expect(records.map(({ type, context }) => [type, context.by, context.actsFor])).toEqual([
      ['run_started', 'playbook:alpha', 'person:user_2ada'],
      ['run_succeeded', 'playbook:alpha', 'person:user_2ada'],
    ]);
    expect(read).toMatchObject({ status: 'succeeded', output: { acts_for: 'person:user_2ada' } });
  });

  it('is nobody for a version a key saved, since a key is no person', async () => {
    const definitions = await savedByAdaThenByAKey();

    const started = await definitions.call(startVersion, { ...starting(2), trigger: every });
    const { records } = await runRecordsOf(definitions, runId);

    expect(started).toMatchObject({ status: 'succeeded', output: { definition_version: 2 } });
    expect(started).not.toHaveProperty('output.acts_for');
    expect(records.map(({ context }) => 'actsFor' in context)).toEqual([false, false]);
  });
});

describe('the person a run a trigger starts acts for, after the version was put in place', () => {
  it('is whoever restored the version since, a resumption changing nothing', async () => {
    const definitions = await savedByAdaThenByAKey();
    await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));
    await definitions.call(restoreDefinition, toAlpha(benOfAcme, { type: 'echo', name: 'greet' }));
    await definitions.call(resumeDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));

    const started = await definitions.call(startVersion, { ...starting(2), trigger: every });

    expect(started).toMatchObject({ status: 'succeeded', output: { acts_for: 'person:user_3ben' } });
  });

  it('is nobody once the person has left the org, as the host that keeps its members says', async () => {
    const definitions = await savedByAdaThenByAKey();
    const startedWhileTheyLeft = (request: PlaybookRequest) =>
      definitions.run(
        definitions.dispatch(startVersion, request).pipe(Effect.provideService(OrgMembership, adaHasLeftAcme)),
      );

    const started = await startedWhileTheyLeft({ ...starting(1), trigger: every });
    const before = await definitions.call(startVersion, { ...starting(1, {}, secondRunId), trigger: every });

    expect(started).toMatchObject({ status: 'succeeded', output: { definition_version: 1 } });
    expect(started).not.toHaveProperty('output.acts_for');
    expect(before).toMatchObject({ status: 'succeeded', output: { acts_for: 'person:user_2ada' } });
  });
});

const goal = { kind: 'goal' as const, reference: 'goals/weekly-revenue/assessments/a-1' };

function startingTheActive(input: object = {}, name = 'greet') {
  return { ...toAlpha(thePlaybook, { type: 'echo', name, input, run_id: runId }), trigger: goal };
}

describe('a start that names no version', () => {
  it('runs the active version under the id the host chose, as the playbook, with its trigger', async () => {
    const definitions = await savedByAdaThenByAKey();

    const started = await definitions.call(startVersion, startingTheActive());
    const { records } = await runRecordsOf(definitions, runId);

    expect(started).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, definition_version: 2, started_by: { id: 'playbook:alpha' } },
    });
    expect(records.map(({ type, context }) => [type, context.trigger])).toEqual([
      ['run_started', goal],
      ['run_succeeded', goal],
    ]);
  });

  it('starts once: a second start under the id answers the first run as it stands and runs nothing', async () => {
    const definitions = await savedByAdaThenByAKey();

    const first = await definitions.call(startVersion, startingTheActive({ n: 1 }));
    const second = await definitions.call(startVersion, startingTheActive({ n: 2 }));
    const { records } = await runRecordsOf(definitions, runId);

    expect(second).toEqual(first);
    expect(records).toHaveLength(2);
  });
});

describe('a start that names no version, of a definition that cannot start', () => {
  it('is not_found for a missing definition, and refuses a paused one and a retired one with what it is', async () => {
    const definitions = await savedByAdaThenByAKey();

    const missing = await definitions.call(startVersion, startingTheActive({}, 'nobody'));
    await definitions.call(pauseDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));
    const paused = await definitions.call(startVersion, startingTheActive());
    await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));
    const retired = await definitions.call(startVersion, startingTheActive());
    const { records } = await runRecordsOf(definitions, runId);

    expect([missing, paused, retired]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'conflict', kind: 'paused' },
      { status: 'rejected', reason: 'conflict', kind: 'retired' },
    ]);
    expect(records).toEqual([]);
  });

  it('answers a run already under the id as it stands while the definition is paused', async () => {
    const definitions = await savedByAdaThenByAKey();
    const first = await definitions.call(startVersion, startingTheActive());
    await definitions.call(pauseDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));

    const again = await definitions.call(startVersion, startingTheActive());

    expect(again).toEqual(first);
  });

  it('answers a run already under the id as it stands once the definition is retired, and starts none under a new id', async () => {
    const definitions = await savedByAdaThenByAKey();
    const first = await definitions.call(startVersion, startingTheActive());
    await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));

    const again = await definitions.call(startVersion, startingTheActive());
    const another = await definitions.call(startVersion, {
      ...toAlpha(thePlaybook, { type: 'echo', name: 'greet', input: {}, run_id: secondRunId }),
      trigger: goal,
    });

    expect(again).toEqual(first);
    expect(another).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'retired' });
    expect((await runRecordsOf(definitions, secondRunId)).records).toEqual([]);
  });
});

const greetById = (definition: string, version = 1, id = runId) => ({
  ...toAlpha(thePlaybook, { type: 'echo', name: 'greet', version, input: {}, run_id: id, definition_id: definition }),
  trigger: every,
});

async function renamedAndTakenAgain() {
  const definitions = await savedByAdaThenByAKey();
  const read = await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));
  const definition = String(Reflect.get(Reflect.get(read, 'output'), 'definition_id'));
  await definitions.call(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', new_name: 'hail' }));
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Yo"}' }),
  );
  return { definitions, definition };
}

function readingTheNameBeforeTheRename(definitions: Harness, stale: number) {
  let reads = 0;
  const service = definitions.ledger.service;
  return Effect.provideService(Ledger, {
    ...service,
    nameHeldBy: (definitionKey: string) =>
      Effect.map(service.nameHeldBy(definitionKey), (held) => {
        reads += 1;
        return held === undefined || reads > stale ? held : { ...held, name: 'greet' };
      }),
  });
}

describe('a start that names the definition by its id, as the host does', () => {
  it('starts the definition it names under the name it holds now, whatever name the start carries', async () => {
    const { definitions, definition } = await renamedAndTakenAgain();

    expect([
      await definitions.call(startVersion, greetById(definition, 2)),
      await definitions.call(startVersion, greetById('id-of-nothing', 1, secondRunId)),
      await definitions.call(startVersion, greetById(definition, 9, secondRunId)),
    ]).toMatchObject([
      { status: 'succeeded', output: { run_id: runId, name: 'hail', definition_version: 2 } },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
  });

  it('starts nothing, and is tried again, when a rename lands between the read of its name and of its version', async () => {
    const { definitions, definition } = await renamedAndTakenAgain();
    const takenMeanwhile = await definitions.run(
      definitions.dispatch(startVersion, greetById(definition)).pipe(readingTheNameBeforeTheRename(definitions, 1)),
    );
    await definitions.call(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', new_name: 'gone' }));
    const freedMeanwhile = await definitions.run(
      definitions.dispatch(startVersion, greetById(definition)).pipe(readingTheNameBeforeTheRename(definitions, 1)),
    );

    expect([takenMeanwhile, freedMeanwhile]).toMatchObject([
      { status: 'rejected', reason: 'unavailable' },
      { status: 'rejected', reason: 'unavailable' },
    ]);
    expect((await runRecordsOf(definitions, runId)).records).toEqual([]);
  });
});
