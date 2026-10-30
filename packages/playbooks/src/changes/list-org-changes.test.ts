import { makeDispatcher } from '@on.auto/operations';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { createPlaybook, defineListOrgChanges, playbookChanges, retirePlaybook, updatePlaybook } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { changesOf } from '../testing/followed-changes.ts';
import { asQueryString, harness, toOrg } from '../testing/harness.ts';

const listOrgChanges = defineListOrgChanges([playbookChanges]);

const toAcme = toOrg('acme');

describe('list_org_changes', () => {
  it('is a query of the org at GET /changes, over HTTP alone, which names the playbooks of its answers', () => {
    expect(listOrgChanges.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_org_changes',
      route: { method: 'GET', path: '/changes' },
      servedOverHttpAlone: { kind: 'none' },
    });
    expect(listOrgChanges.registration.description).toContain('which playbooks of the org changed');
  });

  it('names each playbook created, updated or retired after the cursor once, in order, and none of another org', async () => {
    const { call } = harness();
    const changes = (input: object) => call(listOrgChanges, asQueryString(toAcme(acmeAdmin, input)));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'gamma', name: 'Gamma' }));

    const now = changesOf(await changes({}));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(createPlaybook, toOrg('globex')(globexAdmin, { playbook: 'delta', name: 'Delta' }));
    await call(updatePlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Bet', description: '' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'gamma' }));
    const after = changesOf(await changes({ since: now.cursor, wait: '0' }));

    expect(after).toMatchObject({
      changes: [
        { kind: 'playbook', playbook: 'beta' },
        { kind: 'playbook', playbook: 'alpha' },
        { kind: 'playbook', playbook: 'gamma' },
      ],
      more: false,
    });
  });
});

describe('list_org_changes, while nothing changed', () => {
  it('holds the request until a playbook of the org changes', async () => {
    const { run, call, dispatch } = harness();
    const asked = (input: object) =>
      makeDispatcher([]).dispatchToOrg(listOrgChanges.registration, asQueryString(toAcme(acmeAdmin, input)));
    const now = changesOf(await call(listOrgChanges, asQueryString(toAcme(acmeAdmin))));

    const held = await run(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(asked({ since: now.cursor }));
        yield* TestClock.adjust('3 seconds');
        yield* dispatch(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
        return yield* Fiber.join(waiting);
      }),
    );

    expect(changesOf(held).changes).toEqual([{ kind: 'playbook', playbook: 'alpha' }]);
  });
});
