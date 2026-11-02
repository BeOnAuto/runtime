import { StudioLinks } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, listPlaybooks, retirePlaybook } from '../index.ts';
import { acmeAdmin, acmeAlphaKeeper, acmeGammaReader, acmeReader } from '../testing/callers.ts';
import { asQueryString, firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const welcome = [
  'This organization has no playbooks yet.',
  'A playbook keeps work your team can use again. Its workflows coordinate functions that reason, interact, predict and compute.',
  'Unless the person has already said what they want, ask what they want done, and offer three starts: set up a first playbook, connect a service they use, or hear what Auto can do for their team.',
  'In Studio, your team can review playbooks and run results.',
  'You can also manage workflows, connections, members and billing there.',
].join(' ');

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

  it('lists the active playbooks sorted by id', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();

    expect(await call(listPlaybooks, toAcme(acmeAdmin))).toStrictEqual({
      status: 'succeeded',
      output: { playbooks: [activePlaybook('alpha', 'Alpha'), activePlaybook('gamma', 'Gamma')] },
    });
  });
});

describe('the welcome of list_playbooks', () => {
  it('lists nothing for an org without playbooks, and welcomes it with what a playbook is, three starts and what Studio shows', async () => {
    const { call } = harness();

    expect(await call(listPlaybooks, toAcme(acmeAdmin))).toEqual({
      status: 'succeeded',
      output: { playbooks: [], welcome },
    });
  });

  it("ends the welcome with Studio's link where the server serving the call knows Studio's address", async () => {
    const { dispatch, run } = harness();
    const listed = dispatch(listPlaybooks, toAcme(acmeAdmin)).pipe(
      Effect.provideService(StudioLinks, () => 'https://studio.example/'),
    );

    expect(await run(listed)).toEqual({
      status: 'succeeded',
      output: { playbooks: [], welcome: `${welcome} https://studio.example/` },
    });
  });

  it('relays the welcome as it is', () => {
    expect(listPlaybooks.registration.plainLanguage?.relayed?.({ playbooks: [], welcome })).toBe(welcome);
  });
});

describe('the plain empty list of list_playbooks', () => {
  it('is answered to a caller who may not make the first playbook: one limited to some playbooks, or one that may only read', async () => {
    const { call } = harness();
    const none = { status: 'succeeded', output: { playbooks: [] } };

    expect([
      await call(listPlaybooks, toAcme(acmeGammaReader)),
      await call(listPlaybooks, toAcme(acmeAlphaKeeper)),
      await call(listPlaybooks, toAcme(acmeReader)),
    ]).toEqual([none, none, none]);
  });

  it('is answered to an org with playbooks, though the caller may see none of them, or none is active', async () => {
    const playbooks = harness();
    await playbooks.call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    await playbooks.call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'beta' }), later);
    const none = { status: 'succeeded', output: { playbooks: [] } };

    expect([
      await playbooks.call(listPlaybooks, toAcme(acmeAdmin)),
      await playbooks.call(listPlaybooks, toAcme(acmeGammaReader)),
    ]).toEqual([none, none]);
    expect([
      listPlaybooks.registration.plainLanguage?.outcome(none.output, {}),
      listPlaybooks.registration.plainLanguage?.relayed?.(none.output),
    ]).toEqual(['There is no playbook in use that this connection may see.', undefined]);
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
