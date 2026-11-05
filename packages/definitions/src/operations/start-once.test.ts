import { OrgMembership, playbookCallerOf, type PlaybookRequest } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineStartVersion } from '../index.ts';
import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';

const { createDefinition, updateDefinition, retireDefinition, restoreDefinition, resumeDefinition, getRun } =
  definitionOperationsFor([echo]);

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
