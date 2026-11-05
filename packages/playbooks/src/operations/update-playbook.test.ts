import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createPlaybook, defineUpdatePlaybook, retirePlaybook } from '../index.ts';
import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { getPlaybook, pagesInMemory, refusedPage, updatePlaybook } from '../testing/playbook-pages.ts';

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
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
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
  it('needs a name, a description or a page, each held to its limits', async () => {
    const { call } = await withAlpha();
    const updating = (input: object) => call(updatePlaybook, toAcme(acmeAdmin, { playbook: 'alpha', ...input }));

    expect(await updating({})).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'Give name, description or page, at least one, to update the playbook',
      issues: [{ pointer: '', detail: 'Give name, description or page, at least one, to update the playbook' }],
    });
    expect(await updating({ page: 'p'.repeat(65_537) })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/page' }],
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

async function withAlphaAndItsPages() {
  const pages = pagesInMemory();
  const playbooks = await withAlpha();
  const updating = (input: object, at?: string) =>
    playbooks.call(defineUpdatePlaybook(pages), toAcme(acmeAdmin, { playbook: 'alpha', ...input }), at);
  return { ...playbooks, pages, updating };
}

describe('update_playbook with a page', () => {
  it('saves the page alone, keeping the name and the description, and answers it', async () => {
    const { updating } = await withAlphaAndItsPages();

    expect(await updating({ page: '---\n---\n' }, later)).toStrictEqual({
      status: 'succeeded',
      output: {
        id: 'alpha',
        name: 'Alpha',
        description: 'Answers sales',
        status: 'active',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
        page: { source: '---\n---\n' },
      },
    });
    expect(await updating({ name: 'Alpha Sales', page: '---\n---\n' }, later)).toMatchObject({
      status: 'succeeded',
      output: { name: 'Alpha Sales', updated_at: later, page: { source: '---\n---\n' } },
    });
    expect(await updating({ description: 'Sells' }, later)).toMatchObject({
      output: { name: 'Alpha Sales', description: 'Sells', page: { source: '---\n---\n' } },
    });
  });
});

describe('update_playbook with a page, removed or refused', () => {
  it('removes the page with null', async () => {
    const { updating } = await withAlphaAndItsPages();
    await updating({ page: '---\n---\n' });

    expect(await updating({ page: null })).toMatchObject({ status: 'succeeded' });
    expect(await updating({ page: null })).not.toHaveProperty('output.page');
  });

  it('refuses a page that does not fit its format, and changes nothing else', async () => {
    const { updating, call } = await withAlphaAndItsPages();

    expect(await updating({ name: 'Renamed', page: refusedPage })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The page has a problem',
      issues: [{ pointer: '/page', detail: 'Line 1: a page starts with its front matter' }],
    });
    expect(await call(getPlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }))).toMatchObject({
      output: { name: 'Alpha' },
    });
  });

  it('refuses the page of a retired playbook, and of one the org does not have', async () => {
    const { updating, call, pages } = await withAlphaAndItsPages();
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));

    expect(await updating({ page: '---\n---\n' })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The playbook alpha is retired and cannot change until it is restored',
      kind: 'retired',
    });
    expect(
      await call(defineUpdatePlaybook(pages), toAcme(acmeAdmin, { playbook: 'nowhere', page: '---\n---\n' })),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
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
      detail: 'The playbook alpha is retired and cannot change until it is restored',
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
