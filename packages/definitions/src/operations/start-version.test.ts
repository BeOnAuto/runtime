import { playbookCallerOf, messageIdOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineStartVersion } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, updateDefinition, retireDefinition, getRun } = definitionOperationsFor([echo]);

const startVersion = defineStartVersion([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const thePlaybook = playbookCallerOf({ org: 'acme', playbook: 'alpha' });

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function greetAtTwoVersions() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await definitions.call(
    updateDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  return definitions;
}

function starting(version: number, input: object = {}, id = runId) {
  return toAlpha(thePlaybook, { type: 'echo', name: 'greet', version, input, run_id: id });
}

describe('a start of one version of a definition, once', () => {
  it('runs the version it names, as the playbook, with the depth and lineage of its request', async () => {
    const definitions = await greetAtTwoVersions();
    const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId };

    const started = await definitions.call(startVersion, { ...starting(1, { name: 'Ada' }), lineage, depth: 2 });

    expect(started).toEqual({
      status: 'succeeded',
      output: {
        run_id: runId,
        type: 'echo',
        name: 'greet',
        definition_version: 1,
        status: 'succeeded',
        output: { greeting: 'Hello', input: { name: 'Ada' } },
        started_at: firstMoment,
        started_by: 'playbook:alpha',
        finished_at: firstMoment,
        record: { greeting: 'Hello' },
      },
    });
    expect(definitions.ledger.streamNames().filter((stream) => stream.endsWith(runId))).toEqual([
      `playbook/acme/alpha/runs/${runId}`,
    ]);
  });
});

describe('a start of a version that a trigger asked for', () => {
  it('records the trigger on the start and the ending, while the playbook stays who started it', async () => {
    const definitions = await greetAtTwoVersions();
    const trigger = { kind: 'every' as const, reference: '/schedule/every' };

    const started = await definitions.call(startVersion, { ...starting(2), trigger });
    const { records } = await definitions.run(
      Effect.orDie(
        definitions.ledger.service.readRecorded(
          { org: 'acme', playbook: 'alpha' },
          { kind: 'run', run: runId },
          { order: 'asc', limit: 10 },
        ),
      ),
    );

    expect(started).toMatchObject({ status: 'succeeded', output: { started_by: 'playbook:alpha' } });
    expect(records).toMatchObject([
      { type: 'run_started', context: { trigger } },
      { type: 'run_succeeded', context: { trigger } },
    ]);
  });
});

describe('a start of a version once, under the id of a run', () => {
  it('answers the run that exists under its id and starts nothing, whatever it is asked', async () => {
    const definitions = await greetAtTwoVersions();
    await definitions.call(startVersion, starting(1));

    const again = await definitions.call(startVersion, starting(2, { other: true }));
    const read = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect([again, read]).toMatchObject([
      { status: 'succeeded', output: { definition_version: 1, output: { greeting: 'Hello', input: {} } } },
      { status: 'succeeded', output: { definition_version: 1 } },
    ]);
  });

  it('starts a version that has since been retired, and is not_found for a version the definition never had', async () => {
    const definitions = await greetAtTwoVersions();
    await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));

    const retired = await definitions.call(startVersion, starting(2));
    const missing = await definitions.call(startVersion, starting(3, {}, '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b'));

    expect([retired, missing]).toMatchObject([
      { status: 'succeeded', output: { definition_version: 2, output: { greeting: 'Hi' } } },
      {
        status: 'rejected',
        reason: 'not_found',
        detail: 'There is no version 3 of the echo definition greet in this playbook',
      },
    ]);
  });
});

async function probedOnce() {
  const prober = probe();
  const { createDefinition: creating } = definitionOperationsFor([prober.capability]);
  const definitions = harness();
  await definitions.call(creating, toAlpha(acmeAdmin, { type: 'probe', name: 'react', source: 'react' }));
  const startingProbe = defineStartVersion([prober.capability]);
  const startOnce = () =>
    definitions.call(
      startingProbe,
      toAlpha(thePlaybook, { type: 'probe', name: 'react', version: 1, input: {}, run_id: runId }),
    );
  return { prober, startOnce };
}

describe('a start of a version once whose run ended without a result', () => {
  it('runs again under the same id, so a start the playbook could not take at first goes through later', async () => {
    const { prober, startOnce } = await probedOnce();
    prober.sufferOnNextRun('unavailable');

    const first = await startOnce();
    const again = await startOnce();

    expect([first, again, prober.runs()]).toMatchObject([
      { status: 'rejected', reason: 'unavailable' },
      { status: 'succeeded', output: { status: 'succeeded' } },
      2,
    ]);
  });
});

describe('a start of a version once while its run goes', () => {
  it('answers the run as it stands and runs nothing', async () => {
    const { prober, startOnce } = await probedOnce();
    prober.sufferOnNextRun('stall');
    void startOnce();
    await prober.stalled;

    const again = await startOnce();

    expect([again, prober.runs()]).toMatchObject([{ status: 'succeeded', output: { status: 'started' } }, 1]);
  });
});

describe('the words of a start of a version once', () => {
  it('name what it starts and why', () => {
    expect(
      startVersion.registration.plainLanguage?.attempt({
        type: 'echo',
        name: 'greet',
        version: 1,
        input: {},
        run_id: runId,
      }),
    ).toBe('start the greeting “greet” once, for one of its triggers');
  });
});

const triggers = [
  { kind: 'event', reference: '/schedule/on', filters: [{ reference: '/schedule/on/one', type: 'x', attributes: {} }] },
  { kind: 'every', reference: '/schedule/every', milliseconds: 60_000 },
];

describe('the definitions of a playbook that start on their own', () => {
  it('show their triggers, and a read of one names the record its current version was made by', async () => {
    const definitions = harness();
    const { getDefinition, listDefinitions } = definitionOperationsFor([echo]);
    const source = JSON.stringify({ greeting: 'Hello', triggers });
    await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source }));
    await definitions.call(
      createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'plain', source: '{"greeting": "Hi"}' }),
    );

    const read = await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));
    const plain = await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }));
    const listed = await definitions.call(listDefinitions, toAlpha(acmeAdmin, { type: 'echo' }));

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { triggers, triggers_since: messageIdOf('playbook/acme/alpha/definitions/echo', 1) },
    });
    expect(plain).not.toMatchObject({ output: { triggers } });
    expect(listed).toMatchObject({
      status: 'succeeded',
      output: { definitions: [{ name: 'greet', triggers }, { name: 'plain' }] },
    });
  });
});
