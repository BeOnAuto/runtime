import { describe, expect, it } from 'vitest';

import { createPlaybook, getPlaybook, retirePlaybook } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

describe('get_playbook', () => {
  it('is an org query at GET /playbooks/{playbook}, served over HTTP alone, that may meet not_found', () => {
    expect(getPlaybook.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      title: 'Get playbook',
      route: { method: 'GET', path: '/playbooks/{playbook}' },
      pathParameters: ['playbook'],
      successStatus: 200,
      reasons: ['not_found'],
      servedOverHttpAlone: { kind: 'none' },
    });
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
