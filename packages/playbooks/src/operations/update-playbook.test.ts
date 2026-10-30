import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, retirePlaybook, updatePlaybook } from '../index.ts';
import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

async function withAlpha() {
  const playbooks = harness();
  await playbooks.call(
    createPlaybook,
    toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', description: 'Answers sales' }),
  );
  return playbooks;
}

describe('update_playbook', () => {
  it('is an org command at PUT /playbooks/{playbook} that may meet not_found and conflict', () => {
    expect(updatePlaybook.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Update playbook',
      route: { method: 'PUT', path: '/playbooks/{playbook}' },
      pathParameters: ['playbook'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('replaces the trimmed name and description, keeping who created the playbook and when', async () => {
    const { call } = await withAlpha();
    const update = { playbook: 'alpha', name: ' Alpha Sales ', description: ' ' };

    expect(await call(updatePlaybook, toAcme(acmeAlphaKeeper, update), later)).toStrictEqual({
      status: 'succeeded',
      output: {
        id: 'alpha',
        name: 'Alpha Sales',
        description: '',
        status: 'active',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: later,
      },
    });
  });

  it('succeeds and records nothing when nothing changes', async () => {
    const { call } = await withAlpha();
    const sameAgain = { playbook: 'alpha', name: 'Alpha', description: 'Answers sales' };

    expect(await call(updatePlaybook, toAcme(acmeAdmin, sameAgain), later)).toMatchObject({
      status: 'succeeded',
      output: { name: 'Alpha', updated_at: firstMoment },
    });
  });
});

describe('the input of update_playbook', () => {
  it('needs both the name and the description, held to their limits', async () => {
    const { call } = await withAlpha();
    const updating = (input: object) => call(updatePlaybook, toAcme(acmeAdmin, { playbook: 'alpha', ...input }));

    expect(await updating({ name: 'Alpha Sales' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/description', detail: 'Missing key' }],
    });
    expect(await updating({ name: '', description: 'd'.repeat(2001) })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/name' }, { pointer: '/description' }],
    });
  });

  it('rejects a field the operation does not know', async () => {
    const { call } = await withAlpha();

    expect(
      await call(
        updatePlaybook,
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', description: '', status: 'retired' }),
      ),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});

describe('update_playbook rejecting', () => {
  it('a playbook the org does not have, and a retired playbook', async () => {
    const { call } = await withAlpha();
    const renaming = (playbook: string) =>
      call(updatePlaybook, toAcme(acmeAdmin, { playbook, name: 'Renamed', description: '' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));

    expect(await renaming('nowhere')).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
    expect(await renaming('alpha')).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The playbook alpha is retired and can no longer change',
      kind: 'retired',
    });
  });

  it("with conflict when the org's playbooks changed while it decided", async () => {
    const { dispatch, run } = await withAlpha();
    await run(dispatch(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' })));
    const renaming = (playbook: string) =>
      dispatch(updatePlaybook, toAcme(acmeAdmin, { playbook, name: 'Renamed', description: '' }));

    expect(await run(Effect.all([renaming('alpha'), renaming('beta')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { id: 'alpha', name: 'Renamed' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
