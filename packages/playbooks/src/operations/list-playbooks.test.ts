import { describe, expect, it } from 'vitest';

import { createPlaybook, listPlaybooks, retirePlaybook } from '../index.ts';
import { acmeAdmin, acmeGammaReader } from '../testing/callers.ts';
import { asQueryString, firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

const activeOnly = { status: 'succeeded', output: { playbooks: [{ id: 'alpha' }, { id: 'gamma' }] } };

const retiredToo = {
  status: 'succeeded',
  output: { playbooks: [{ id: 'alpha' }, { id: 'beta', status: 'retired', retired_at: later }, { id: 'gamma' }] },
};

function activePlaybook(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    status: 'active',
    created_at: firstMoment,
    created_by: { id: 'acme-admin', name: 'acme-admin' },
    updated_at: firstMoment,
  };
}

async function withGammaAlphaAndRetiredBeta() {
  const playbooks = harness();
  await playbooks.call(createPlaybook, toAcme(acmeAdmin, { playbook: 'gamma', name: 'Gamma' }));
  await playbooks.call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
  await playbooks.call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
  await playbooks.call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'beta' }), later);
  return playbooks;
}

describe('list_playbooks', () => {
  it('is an org query at GET /playbooks that declares no rejection', () => {
    expect(listPlaybooks.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      title: 'List playbooks',
      route: { method: 'GET', path: '/playbooks' },
      pathParameters: [],
      successStatus: 200,
      reasons: [],
      permissions: ['org:read', 'playbook:read'],
    });
  });

  it('answers a caller that may only read inside some playbooks, with those playbooks alone', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    expect(await call(listPlaybooks, toAcme(acmeGammaReader))).toMatchObject({
      status: 'succeeded',
      output: { playbooks: [{ id: 'gamma' }] },
    });
  });

  it('lists nothing for an org without playbooks', async () => {
    const { call } = harness();

    expect(await call(listPlaybooks, toAcme(acmeAdmin))).toEqual({ status: 'succeeded', output: { playbooks: [] } });
  });

  it('says in the same words to an empty org and to a key whose playbooks are not made yet that it sees no playbook', async () => {
    const { call } = harness();
    const empty = { status: 'succeeded', output: { playbooks: [] } };

    expect([await call(listPlaybooks, toAcme(acmeAdmin)), await call(listPlaybooks, toAcme(acmeGammaReader))]).toEqual([
      empty,
      empty,
    ]);
    expect(listPlaybooks.registration.plainLanguage?.outcome(empty.output, {})).toBe(
      'There is no playbook in use that this connection may see.',
    );
  });

  it('lists the active playbooks sorted by id', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();

    expect(await call(listPlaybooks, toAcme(acmeAdmin))).toStrictEqual({
      status: 'succeeded',
      output: { playbooks: [activePlaybook('alpha', 'Alpha'), activePlaybook('gamma', 'Gamma')] },
    });
  });
});

describe('include_retired', () => {
  it('lists the retired playbooks too when true in JSON', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listPlaybooks, toAcme(acmeAdmin, input));

    expect(await listing({ include_retired: true })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: false })).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'true' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired', detail: 'Expected boolean' }],
    });
  });

  it('lists the retired playbooks too when true in a query string', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listPlaybooks, asQueryString(toAcme(acmeAdmin, input)));

    expect(await listing({ include_retired: 'true' })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: 'false' })).toMatchObject(activeOnly);
    expect(await listing({})).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'yes' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired' }],
    });
  });

  it('is the only field list_playbooks knows', async () => {
    const { call } = harness();

    expect(await call(listPlaybooks, toAcme(acmeAdmin, { status: 'retired' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});
