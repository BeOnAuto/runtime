import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, defineGetPlaybook, defineUpdatePlaybook, restorePlaybook, retirePlaybook } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { getPlaybook, pagesInMemory } from '../testing/playbook-pages.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const activeAlpha = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'active',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
};

describe('restore_playbook', () => {
  it('is an org command at POST /playbooks/{playbook}/restore that may meet not_found and conflict', () => {
    expect(restorePlaybook.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Restore playbook',
      route: { method: 'POST', path: '/playbooks/{playbook}/restore' },
      pathParameters: ['playbook'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('brings a retired playbook back active, recording when, without its retirement', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), later);

    expect(await call(restorePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: { ...activeAlpha, updated_at: muchLater },
    });
  });

  it('succeeds and records nothing for a playbook that is not retired', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));

    expect(await call(restorePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), later)).toStrictEqual({
      status: 'succeeded',
      output: activeAlpha,
    });
  });

  it('leaves a restored playbook to be retired again', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));
    await call(restorePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), later);

    expect(await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), muchLater)).toMatchObject({
      status: 'succeeded',
      output: { status: 'retired', retired_at: muchLater },
    });
  });
});

describe('restore_playbook rejecting', () => {
  it('a playbook the org does not have', async () => {
    const { call } = harness();

    expect(await call(restorePlaybook, toAcme(acmeAdmin, { playbook: 'nowhere' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
  });

  it('a malformed id and a field the operation does not know', async () => {
    const { call } = harness();

    expect(await call(restorePlaybook, toAcme(acmeAdmin, { playbook: 'al', reason: 'back' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/reason' }, { pointer: '/playbook' }],
    });
  });

  it("with conflict when the org's playbooks changed while it decided", async () => {
    const { dispatch, run } = harness();
    await run(dispatch(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' })));
    await run(dispatch(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' })));
    await run(dispatch(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' })));
    await run(dispatch(retirePlaybook, toAcme(acmeAdmin, { playbook: 'beta' })));
    const restoring = (playbook: string) => dispatch(restorePlaybook, toAcme(acmeAdmin, { playbook }));

    expect(await run(Effect.all([restoring('alpha'), restoring('beta')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { id: 'alpha', status: 'active' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});

describe('get_playbook', () => {
  it('is an org query at GET /playbooks/{playbook}, served as a tool too, that may meet not_found', () => {
    expect(getPlaybook.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      title: 'Get playbook',
      route: { method: 'GET', path: '/playbooks/{playbook}' },
      pathParameters: ['playbook'],
      successStatus: 200,
      reasons: ['not_found'],
    });
    expect(getPlaybook.registration).not.toHaveProperty('servedOverHttpAlone');
  });

  it('reads a playbook, active or retired', async () => {
    const { call } = harness();
    const reading = (playbook: string) => call(getPlaybook, toAcme(acmeAdmin, { playbook }));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', description: 'Answers sales' }));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'beta' }), later);

    expect(await reading('alpha')).toStrictEqual({
      status: 'succeeded',
      output: {
        id: 'alpha',
        name: 'Alpha',
        description: 'Answers sales',
        status: 'active',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
      },
    });
    expect(await reading('beta')).toMatchObject({
      status: 'succeeded',
      output: { status: 'retired', retired_at: later },
    });
  });
});

describe('get_playbook of a playbook with a page', () => {
  it("answers the page's source", async () => {
    const pages = pagesInMemory();
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(defineUpdatePlaybook(pages), toAcme(acmeAdmin, { playbook: 'alpha', page: '---\n---\n' }));

    expect(await call(defineGetPlaybook(pages), toAcme(acmeAdmin, { playbook: 'alpha' }))).toMatchObject({
      status: 'succeeded',
      output: { id: 'alpha', page: { source: '---\n---\n' } },
    });
  });

  it('says what it looked up and found', () => {
    const { plainLanguage } = getPlaybook.registration;

    expect([
      plainLanguage?.attempt({ playbook: 'alpha' }),
      plainLanguage?.outcome(
        {
          id: 'alpha',
          name: 'Alpha',
          description: 'Answers sales',
          status: 'active',
          created_at: firstMoment,
          created_by: { id: 'acme-admin', name: 'acme-admin' },
          updated_at: firstMoment,
        },
        { playbook: 'alpha' },
      ),
    ]).toEqual(['look up the playbook “alpha”', 'Found the playbook “Alpha”. What it is for: Answers sales.']);
  });
});

describe('get_playbook rejecting', () => {
  it('a playbook the org does not have', async () => {
    const { call } = harness();

    expect(await call(getPlaybook, toAcme(acmeAdmin, { playbook: 'nowhere' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
  });

  it('a malformed id and a field the operation does not know', async () => {
    const { call } = harness();

    expect(await call(getPlaybook, toAcme(acmeAdmin, { playbook: 'no_where', verbose: true }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/verbose' }, { pointer: '/playbook' }],
    });
  });
});
