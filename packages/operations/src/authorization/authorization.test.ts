import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineQuery, permissionRefusalOf, type CallerIdentity } from '../index.ts';
import { acmeAdmin, acmeAlphaReader } from '../testing/callers.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';

const toAcme = toOrg('acme');

const toAlpha = toPlaybook('acme', 'alpha');

function holding(...permissions: CallerIdentity['permissions']): CallerIdentity {
  return { ...acmeAdmin, id: 'acme-limited', permissions };
}

describe('authorization of a caller', () => {
  it('rejects a caller of another org identically for an existing and a missing playbook', async () => {
    const { dispatcher: calls, run } = harness();

    const existing = await run(
      calls.dispatchToPlaybook(getNote.registration, toPlaybook('globex', 'gamma')(acmeAdmin)),
    );
    const missing = await run(
      calls.dispatchToPlaybook(getNote.registration, toPlaybook('globex', 'nowhere')(acmeAdmin)),
    );

    expect(existing).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller does not belong to this org',
    });
    expect(missing).toEqual(existing);
  });

  it('checks the org of the caller before its permissions', async () => {
    const { dispatcher: calls, run } = harness();

    expect(await run(calls.dispatchToOrg(labelPlaybook.registration, toOrg('globex')(acmeAlphaReader)))).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
  });

  it('derives the permission a call needs from the kind and the scope of the operation', async () => {
    const { dispatcher: calls, run } = harness();

    expect(
      await run(calls.dispatchToOrg(listPlaybookLabels.registration, toAcme(holding('playbook:read')))),
    ).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller lacks the org:read permission',
    });
    expect(await run(calls.dispatchToOrg(labelPlaybook.registration, toAcme(holding('org:read'))))).toMatchObject({
      detail: 'The caller lacks the org:write permission',
    });
    expect(await run(calls.dispatchToPlaybook(getNote.registration, toAlpha(holding('org:read'))))).toMatchObject({
      detail: 'The caller lacks the playbook:read permission',
    });
    expect(await run(calls.dispatchToPlaybook(addNote.registration, toAlpha(holding('playbook:read'))))).toMatchObject({
      detail: 'The caller lacks the playbook:write permission',
    });
  });
});

const countPlaybooks = defineQuery('org', {
  name: 'count_playbooks',
  title: 'Count playbooks',
  description: 'Counts the playbooks the caller may read.',
  route: { method: 'GET', path: '/playbook-count' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ counted: Schema.Boolean }),
  reasons: [],
  permittedBy: ['org:read', 'playbook:read'],
  handle: () => Effect.succeed({ counted: true }),
});

describe('an operation permitted by more than one permission', () => {
  it('reaches a caller that holds any one of them, and refuses one that holds none, naming each', async () => {
    const { dispatcher: calls, run } = harness();

    expect(await run(calls.dispatchToOrg(countPlaybooks.registration, toAcme(holding('playbook:read'))))).toEqual({
      status: 'succeeded',
      output: { counted: true },
    });
    expect(await run(calls.dispatchToOrg(countPlaybooks.registration, toAcme(holding('org:write'))))).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller lacks the org:read or playbook:read permission',
    });
  });
});

describe('the words of a missing permission', () => {
  it('are the refusal a dispatched call answers, for a caller that holds none of the permissions, and none otherwise', async () => {
    const { dispatcher: calls, run } = harness();
    const reader = holding('org:read');

    const dispatched = await run(calls.dispatchToOrg(labelPlaybook.registration, toAcme(reader)));

    expect(dispatched).toMatchObject({ detail: permissionRefusalOf(labelPlaybook.registration.permissions, reader) });
    expect(permissionRefusalOf(['org:read', 'playbook:read'], reader)).toBeUndefined();
  });
});

describe('access to a playbook', () => {
  it('rejects a playbook the caller may not access, identically whether it exists or not', async () => {
    const { dispatcher: calls, run } = harness();

    const existing = await run(
      calls.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'beta')(acmeAlphaReader)),
    );
    const missing = await run(
      calls.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'nowhere')(acmeAlphaReader)),
    );

    expect(existing).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may not access this playbook',
    });
    expect(missing).toEqual(existing);
  });

  it('reveals that a playbook is missing only to a caller that may access it', async () => {
    const { dispatcher: calls, run } = harness();

    expect(await run(calls.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'nowhere')(acmeAdmin)))).toEqual(
      {
        status: 'rejected',
        reason: 'not_found',
        detail: 'There is no playbook nowhere in this org',
      },
    );
  });

  it('rejects an ill-formed playbook id before asking the registry, without echoing it', async () => {
    const { dispatcher: calls, run } = harness({ playbooks: [{ org: 'acme', playbook: 'No Playbook' }] });

    expect(
      await run(calls.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'No Playbook')(acmeAdmin))),
    ).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no such playbook in this org',
    });
  });
});

describe('a retired playbook', () => {
  const retiredPlaybooks = [{ org: 'acme', playbook: 'omega' }];
  const toOmega = toPlaybook('acme', 'omega');

  it('answers every query, so what it recorded stays readable', async () => {
    const { dispatcher: calls, run } = harness({ retiredPlaybooks });

    expect(await run(calls.dispatchToPlaybook(getNote.registration, toOmega(acmeAdmin, { name: 'anvil' })))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no note anvil',
    });
  });

  it('refuses every command with the conflict update_playbook gives for a retired playbook', async () => {
    const { dispatcher: calls, ledger, run } = harness({ retiredPlaybooks });

    expect(
      await run(calls.dispatchToPlaybook(addNote.registration, toOmega(acmeAdmin, { name: 'anvil', text: 'heavy' }))),
    ).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The playbook omega is retired and can no longer change',
      kind: 'retired',
    });
    expect(ledger.streamNames()).toEqual([]);
  });
});

describe('the org id of a call', () => {
  const illFormed = 'ac/me';
  const localDeveloper = { ...acmeAdmin, org: illFormed };

  it('is checked after the caller, at org and at playbook scope', async () => {
    const { dispatcher: calls, run } = harness();
    const writingOnly: CallerIdentity = { ...localDeveloper, permissions: ['playbook:write'] };

    expect(await run(calls.dispatchToOrg(listPlaybookLabels.registration, toOrg(illFormed)(acmeAdmin)))).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
    expect(
      await run(calls.dispatchToPlaybook(getNote.registration, toPlaybook(illFormed, 'alpha')(acmeAdmin))),
    ).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
    expect(
      await run(calls.dispatchToOrg(listPlaybookLabels.registration, toOrg(illFormed)(writingOnly))),
    ).toMatchObject({
      detail: 'The caller lacks the org:read permission',
    });
    expect(
      await run(calls.dispatchToPlaybook(getNote.registration, toPlaybook(illFormed, 'alpha')(writingOnly))),
    ).toMatchObject({
      detail: 'The caller lacks the playbook:read permission',
    });
  });

  it('must be well formed, at org and at playbook scope', async () => {
    const { dispatcher: calls, run } = harness({ playbooks: [{ org: illFormed, playbook: 'alpha' }] });
    const noSuchOrg = { status: 'rejected', reason: 'not_found', detail: 'There is no such org' };

    expect(await run(calls.dispatchToOrg(listPlaybookLabels.registration, toOrg(illFormed)(localDeveloper)))).toEqual(
      noSuchOrg,
    );
    expect(
      await run(calls.dispatchToPlaybook(getNote.registration, toPlaybook(illFormed, 'alpha')(localDeveloper))),
    ).toEqual(noSuchOrg);
  });
});

describe('a rejection of authorization', () => {
  it('is a value of its own that a consumer may not spoil for later calls', async () => {
    const { dispatcher: calls, run } = harness();
    const accessDenied = () =>
      run(calls.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'beta')(acmeAlphaReader)));
    const abroad = () => run(calls.dispatchToPlaybook(getNote.registration, toPlaybook('globex', 'gamma')(acmeAdmin)));

    Reflect.set(await accessDenied(), 'detail', 'spoiled');
    Reflect.set(await abroad(), 'detail', 'spoiled');

    expect(await accessDenied()).toMatchObject({ detail: 'The caller may not access this playbook' });
    expect(await abroad()).toMatchObject({ detail: 'The caller does not belong to this org' });
  });
});
