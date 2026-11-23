import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { Effect, Fiber, Predicate } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { createPlaybook, defineListOrgChanges, playbookChanges, retirePlaybook } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { changesOf, followedNamings, followedPresenters } from '../testing/followed-changes.ts';
import { asQueryString, harness, toOrg, type Harness } from '../testing/harness.ts';
import { recorder } from '../testing/playbook-feed.ts';
import { updatePlaybook } from '../testing/playbook-pages.ts';

const listOrgChanges = defineListOrgChanges([playbookChanges]);

const toAcme = toOrg('acme');

const listEveryChange = defineListOrgChanges([playbookChanges], {
  presenters: followedPresenters,
  namings: followedNamings,
});

const acrossIt = { scope: 'org_and_playbooks' };

const alphaReader: CallerIdentity = { ...acmeAdmin, id: 'alpha-reader', name: 'alpha-reader', playbooks: ['alpha'] };

function recorded({ ledger }: Harness, stream: string) {
  return Effect.orDie(
    ledger.service.execute(stream, recorder, {
      fact: { type: 'added', data: { text: stream } },
      at: '2026-10-01T09:00:00.000Z',
    }),
  );
}

function request(input: object) {
  return makeDispatcher([]).dispatchToOrg(
    listEveryChange.registration,
    asQueryString(toAcme(acmeAdmin, { ...acrossIt, ...input })),
  );
}

function readableIn(outcome: Outcome): unknown {
  return outcome.status === 'succeeded' && Predicate.hasProperty(outcome.output, 'playbooks')
    ? outcome.output.playbooks
    : undefined;
}

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

describe('list_org_changes, across the org and its playbooks', () => {
  it('names each change in a playbook with its playbook, the playbook itself once, and says which playbooks the caller may read', async () => {
    const asked = harness();
    const changes = (caller: CallerIdentity, input: object) =>
      asked.call(listEveryChange, asQueryString(toAcme(caller, { ...acrossIt, ...input })));
    const nowOfTheAdmin = changesOf(await changes(acmeAdmin, {}));
    const nowOfTheReader = changesOf(await changes(alphaReader, {}));
    await asked.call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    await asked.run(recorded(asked, 'playbook/acme/alpha/runs/r1'));
    await asked.run(recorded(asked, 'playbook/acme/beta/tags/t1'));
    await asked.run(recorded(asked, 'playbook/globex/alpha/runs/r2'));
    const ofTheAdmin = await changes(acmeAdmin, { since: nowOfTheAdmin.cursor, wait: '0' });
    const ofTheReader = await changes(alphaReader, { since: nowOfTheReader.cursor, wait: '0' });

    expect(changesOf(ofTheAdmin).changes).toEqual([
      { kind: 'playbook', playbook: 'beta' },
      { kind: 'run', run_id: 'r1', playbook: 'alpha' },
      { kind: 'tag', tag: 't1', playbook: 'beta' },
    ]);
    expect(changesOf(ofTheReader).changes).toEqual([{ kind: 'run', run_id: 'r1', playbook: 'alpha' }]);
    expect([readableIn(ofTheAdmin), readableIn(ofTheReader)]).toEqual(['*', ['alpha']]);
  });
});

describe('list_org_changes, across the org and its playbooks, held or refused', () => {
  it("answers the org's own scope as before when no scope is given, with no word of the playbooks", async () => {
    const asked = harness();
    const changes = (input: object) => asked.call(listEveryChange, asQueryString(toAcme(acmeAdmin, input)));
    const now = changesOf(await changes({}));
    await asked.run(recorded(asked, 'playbook/acme/alpha/runs/r1'));
    await asked.call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    const after = await changes({ since: now.cursor, wait: '0' });

    expect(changesOf(after).changes).toEqual([{ kind: 'playbook', playbook: 'beta' }]);
    expect(readableIn(after)).toBeUndefined();
  });

  it('holds the request until something changes in any playbook of the org', async () => {
    const asked = harness();
    const now = changesOf(await asked.run(request({})));

    const held = await asked.run(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(request({ since: now.cursor }));
        yield* TestClock.adjust('3 seconds');
        yield* recorded(asked, 'playbook/acme/gamma/runs/r3');
        return yield* Fiber.join(waiting);
      }),
    );

    expect(changesOf(held).changes).toEqual([{ kind: 'run', run_id: 'r3', playbook: 'gamma' }]);
  });

  it('refuses a scope across the playbooks where it was composed without their namings', async () => {
    const { call } = harness();

    const refused = await call(listOrgChanges, asQueryString(toAcme(acmeAdmin, acrossIt)));

    expect(refused).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });
});
