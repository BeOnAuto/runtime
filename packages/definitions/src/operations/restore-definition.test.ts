import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';

const { createDefinition, restoreDefinition, resumeDefinition, retireDefinition, runDefinition, updateDefinition } =
  definitionOperationsFor([probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const plain = { type: 'probe', name: 'plain' };

const restoredPlain = {
  type: 'probe',
  name: 'plain',
  version: 1,
  status: 'paused',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: muchLater,
  paused_at: muchLater,
  paused_by: { id: 'person:user_2ada', name: 'Ada Lovelace' },
  source: 'text',
};

async function typesOfTheDefinitions({ ledger, run }: Harness) {
  const { records } = await run(
    Effect.orDie(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'everything' },
        { order: 'asc', limit: 20 },
      ),
    ),
  );
  return records.filter(({ stream }) => stream.endsWith('definitions/probe')).map(({ type }) => type);
}

async function retiredPlain() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, plain), later);
  return definitions;
}

describe('restore_definition', () => {
  it('is a playbook command at POST /definitions/{type}/{name}/restore that a repeat records nothing of', () => {
    expect(restoreDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Restore definition',
      route: { method: 'POST', path: '/definitions/{type}/{name}/restore' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      repeatable: true,
      irreversible: false,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('brings a retired definition back paused at its version, by whoever restored it and when, forgetting its retirement', async () => {
    const { call } = await retiredPlain();

    expect(await call(restoreDefinition, toAlpha(adaOfAcme, plain), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: restoredPlain,
    });
    expect(await call(runDefinition, toAlpha(acmeAdmin, plain), muchLater)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'paused',
    });
  });

  it('lets the definition run and change again once it is resumed', async () => {
    const { call } = await retiredPlain();
    await call(restoreDefinition, toAlpha(adaOfAcme, plain), muchLater);

    expect(await call(resumeDefinition, toAlpha(acmeAdmin, plain), muchLater)).toMatchObject({
      status: 'succeeded',
      output: { status: 'active', version: 1 },
    });
    expect(await call(runDefinition, toAlpha(acmeAdmin, plain), muchLater)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
    expect(await call(updateDefinition, toAlpha(acmeAdmin, { ...plain, source: 'more text' }))).toMatchObject({
      status: 'succeeded',
      output: { status: 'active', version: 2 },
    });
  });
});

describe('restore_definition repeated', () => {
  it('succeeds and records nothing for a definition that is not retired', async () => {
    const definitions = await retiredPlain();
    await definitions.call(restoreDefinition, toAlpha(adaOfAcme, plain), muchLater);

    expect(
      await definitions.call(restoreDefinition, toAlpha(acmeAdmin, plain), '2026-12-01T00:00:00.000Z'),
    ).toStrictEqual({ status: 'succeeded', output: restoredPlain });
    expect(await typesOfTheDefinitions(definitions)).toEqual([
      'definition_created',
      'definition_retired',
      'definition_restored',
    ]);
  });

  it('is refused for a definition the playbook does not have', async () => {
    const { call } = await retiredPlain();

    expect(await call(restoreDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'missing' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no probe definition missing in this playbook',
    });
  });
});

describe('the plain language of restore_definition', () => {
  it('says the definition is back, paused, and to resume it when it is ready', () => {
    expect(restoreDefinition.registration.plainLanguage?.outcome(restoredPlain, plain)).toBe(
      'Restored the probe “plain”. It is paused: resume it when it is ready to run.',
    );
  });

  it('names the definition it tried to restore', () => {
    expect([
      restoreDefinition.registration.plainLanguage?.attempt(plain),
      restoreDefinition.registration.plainLanguage?.attempt({}),
    ]).toEqual(['restore the probe “plain”', 'restore a probe']);
  });
});
