import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, runDefinition, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const retiringPlain = toAlpha(acmeAdmin, { type: 'probe', name: 'plain' });

const retiredPlain = {
  type: 'probe',
  name: 'plain',
  version: 1,
  status: 'retired',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: 'acme-admin',
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
  it('is a playbook command at POST /definitions/{type}/{name}/retire', () => {
    expect(retireDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Retire definition',
      route: { method: 'POST', path: '/definitions/{type}/{name}/retire' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('retires a definition for good, recording when', async () => {
    const { call } = await withPlain();

    expect(await call(retireDefinition, retiringPlain, later)).toStrictEqual({
      status: 'succeeded',
      output: retiredPlain,
    });
  });

  it('succeeds and records nothing for a definition that is already retired', async () => {
    const { call } = await withPlain();
    await call(retireDefinition, retiringPlain, later);

    expect(await call(retireDefinition, retiringPlain, muchLater)).toStrictEqual({
      status: 'succeeded',
      output: retiredPlain,
    });
  });

  it('leaves a definition that can no longer be executed', async () => {
    const { call } = await withPlain();
    await call(retireDefinition, retiringPlain);

    expect(await call(runDefinition, retiringPlain)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The probe definition plain is retired and can no longer be run',
      kind: 'retired',
    });
  });
});

describe('retire_definition rejecting', () => {
  it('a definition the playbook does not have, and a type the server does not run', async () => {
    const { call } = await withPlain();

    expect(await call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo definition plain in this playbook',
    });
    expect(await call(retireDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: echo or probe' }],
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
