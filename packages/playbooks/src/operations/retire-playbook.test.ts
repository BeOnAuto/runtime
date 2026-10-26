import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, retirePlaybook } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const retiredAlpha = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'retired',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: later,
  retired_at: later,
};

describe('retire_playbook', () => {
  it('is an org command at POST /playbooks/{playbook}/retire that may meet not_found and conflict', () => {
    expect(retirePlaybook.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Retire playbook',
      route: { method: 'POST', path: '/playbooks/{playbook}/retire' },
      pathParameters: ['playbook'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('retires a playbook for good, recording when', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));

    expect(await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), later)).toStrictEqual({
      status: 'succeeded',
      output: retiredAlpha,
    });
  });

  it('succeeds and records nothing for a playbook that is already retired', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), later);

    expect(await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: retiredAlpha,
    });
  });
});

describe('retire_playbook rejecting', () => {
  it('a playbook the org does not have', async () => {
    const { call } = harness();

    expect(await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'nowhere' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
  });

  it('a malformed id and a field the operation does not know', async () => {
    const { call } = harness();

    expect(await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'al', reason: 'done' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/reason' }, { pointer: '/playbook' }],
    });
  });

  it("with conflict when the org's playbooks changed while it decided", async () => {
    const { dispatch, run } = harness();
    await run(dispatch(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' })));
    await run(dispatch(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' })));
    const retiring = (playbook: string) => dispatch(retirePlaybook, toAcme(acmeAdmin, { playbook }));

    expect(await run(Effect.all([retiring('alpha'), retiring('beta')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { id: 'alpha', status: 'retired' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
