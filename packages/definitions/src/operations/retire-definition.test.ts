import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const anId: unknown = expect.any(String);

const { createDefinition, runDefinition, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const retiringPlain = toAlpha(acmeAdmin, { type: 'probe', name: 'plain' });

const retiredPlain = {
  type: 'probe',
  name: 'plain',
  definition_id: anId,
  version: 1,
  status: 'retired',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: later,
  retired_at: later,
  source: 'text',
};

async function withPlain() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }));
  return definitions;
}

describe('retire_definition', () => {
  it('retires a definition for good, recording when', async () => {
    const { call } = await withPlain();

    expect(await call(retireDefinition, retiringPlain, later)).toStrictEqual({
      status: 'succeeded',
      output: retiredPlain,
    });
  });

  it('leaves a definition that can no longer be executed', async () => {
    const { call } = await withPlain();
    await call(retireDefinition, retiringPlain);

    expect(await call(runDefinition, retiringPlain)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'retired',
    });
  });
});

describe('retire_definition rejecting', () => {
  it('a definition the playbook does not have as not found, and a type the server does not run as invalid input', async () => {
    const { call } = await withPlain();

    expect(await call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
    expect(await call(retireDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'plain' }))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/type' }],
    });
  });

  it('with conflict when another change to the definitions of the capability landed at the same moment', async () => {
    const { call, dispatch, run } = await withPlain();
    await call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'other', source: 'text' }));
    const retiring = (name: string) => dispatch(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name }));

    expect(await run(Effect.all([retiring('plain'), retiring('other')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { name: 'plain', status: 'retired' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
