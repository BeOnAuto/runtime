import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const anId: unknown = expect.any(String);

const { createDefinition, restoreDefinition, resumeDefinition, retireDefinition, runDefinition, updateDefinition } =
  definitionOperationsFor([probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const plain = { type: 'probe', name: 'plain' };

const restoredPlain = {
  type: 'probe',
  name: 'plain',
  definition_id: anId,
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

async function retiredPlain() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, plain), later);
  return definitions;
}

describe('restore_definition', () => {
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

describe('restore_definition rejecting', () => {
  it('a definition the playbook does not have, as not found', async () => {
    const { call } = await retiredPlain();

    expect(await call(restoreDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'missing' }))).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});

describe('the plain language of restore_definition', () => {
  it('names the definition in what it tried and in its outcome, and a kind alone when it has no name', () => {
    const { plainLanguage } = restoreDefinition.registration;
    const outcome = plainLanguage?.outcome({ ...restoredPlain, definition_id: 'id-of-plain' }, plain);

    expect([outcome, plainLanguage?.attempt(plain)]).toEqual([
      expect.stringContaining('plain'),
      expect.stringContaining('plain'),
    ]);
    expect(plainLanguage?.attempt({})).not.toContain('plain');
  });
});
