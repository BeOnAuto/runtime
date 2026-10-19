import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { overviewOfAProbe, probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, getDefinition, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

async function withActiveAndRetiredDefinitions() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }));
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'stale', source: 'old' }));
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'stale' }), later);
  return definitions;
}

describe('get_definition', () => {
  it('is a playbook query at GET /definitions/{type}/{name} that may meet not_found', () => {
    expect(getDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      title: 'Get definition',
      route: { method: 'GET', path: '/definitions/{type}/{name}' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('reads a definition with its document, active or retired, from JSON and from a query string', async () => {
    const { call } = await withActiveAndRetiredDefinitions();

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain' }))).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'probe',
        name: 'plain',
        version: 1,
        status: 'active',
        media_type: 'text/plain',
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: firstMoment,
        source: 'text',
        overview: overviewOfAProbe('plain'),
      },
    });
    expect(
      await call(getDefinition, asQueryString(toAlpha(acmeAdmin, { type: 'probe', name: 'stale' }))),
    ).toMatchObject({ status: 'succeeded', output: { status: 'retired', retired_at: later, source: 'old' } });
  });
});

describe('get_definition rejecting', () => {
  it('a definition the capability does not have in the playbook, and a type the server does not run', async () => {
    const { call } = await withActiveAndRetiredDefinitions();

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo definition plain in this playbook',
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: echo or probe' }],
    });
  });

  it('a malformed name and a field the operation does not know', async () => {
    expect(
      await harness().call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'no_where', verbose: true })),
    ).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/verbose' }, { pointer: '/name' }] });
  });
});
