import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, listDefinitions, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const activeOnly = { status: 'succeeded', output: { definitions: [{ name: 'alpha' }, { name: 'gamma' }] } };

const retiredToo = {
  status: 'succeeded',
  output: {
    definitions: [{ name: 'alpha' }, { name: 'beta', status: 'retired', retired_at: later }, { name: 'gamma' }],
  },
};

function listed(name: string) {
  return {
    type: 'probe',
    name,
    version: 1,
    status: 'active',
    media_type: 'text/plain',
    created_at: firstMoment,
    created_by: { id: 'acme-admin', name: 'acme-admin' },
    updated_at: firstMoment,
  };
}

async function withGammaAlphaAndRetiredBeta() {
  const definitions = harness();
  const creating = (name: string) =>
    definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name, source: name }));
  await creating('gamma');
  await creating('alpha');
  await creating('beta');
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'beta' }), later);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'delta', source: '{"greeting": "Hi"}' }),
  );
  return definitions;
}

describe('list_definitions', () => {
  it('is a playbook query at GET /definitions/{type} that may meet not_found', () => {
    expect(listDefinitions.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      title: 'List definitions',
      route: { method: 'GET', path: '/definitions/{type}' },
      pathParameters: ['type'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('lists nothing for a capability without definitions', async () => {
    expect(await harness().call(listDefinitions, toAlpha(acmeAdmin, { type: 'echo' }))).toEqual({
      status: 'succeeded',
      output: { definitions: [] },
    });
  });

  it('lists the active definitions of the capability sorted by name, without their documents', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();

    expect(await call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe' }))).toStrictEqual({
      status: 'succeeded',
      output: { definitions: [listed('alpha'), listed('gamma')] },
    });
    expect(await call(listDefinitions, toAlpha(acmeAdmin, { type: 'echo' }))).toMatchObject({
      output: { definitions: [{ type: 'echo', name: 'delta', media_type: 'application/json' }] },
    });
  });

  it('rejects a type the server does not run', async () => {
    expect(await harness().call(listDefinitions, toAlpha(acmeAdmin, { type: 'reasoning' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: echo or probe' }],
    });
  });
});

describe('include_retired', () => {
  it('lists the retired definitions too when true in JSON', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe', ...input }));

    expect(await listing({ include_retired: true })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: false })).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'true' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired', detail: 'Expected boolean' }],
    });
  });

  it('lists the retired definitions too when true in a query string', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) =>
      call(listDefinitions, asQueryString(toAlpha(acmeAdmin, { type: 'probe', ...input })));

    expect(await listing({ include_retired: 'true' })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: 'false' })).toMatchObject(activeOnly);
    expect(await listing({})).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'yes' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired' }],
    });
  });

  it('and capability are the only fields list_definitions knows', async () => {
    expect(
      await harness().call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe', status: 'retired' })),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});
