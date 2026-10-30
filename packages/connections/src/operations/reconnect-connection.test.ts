import type { CallerIdentity } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { added, crm, notes, reconnected, reconnecting, type Added } from '../testing/additions.ts';
import { brokenCrm, connectedCrm, giving } from '../testing/crm-connections.ts';
import { acmeReader, ada, grace, harness, operationNamed, recordedAs, type Harness } from '../testing/harness.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const aDayOn = '2026-10-16T14:00:00.000Z';

const aDayAndAMinuteLater = '2026-10-16T14:01:00.000Z';

const keyRefused =
  'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it';

const refusedAsBroken = { kind: 'credential_refused', detail: keyRefused };

const replacedLink = {
  status: 'rejected',
  reason: 'not_found',
  detail: 'There is no open link of this token: a newer link of the connection crm replaced it',
};

function reading(h: Harness, { id, token }: Added, at?: string) {
  return h.call(operationNamed(h.operations, 'read_link'), ada, { id, token }, at);
}

function onEveryPageOperation(h: Harness, { id, token }: Added, at: string) {
  const uses = [
    ['read_link', { id, token }],
    ['approve', { id, token }],
    ['give_credential', { id, token, value: 'Bearer crm-key-7d2e4b19' }],
    ['start', { id, token }],
    ['finish', { id, token, state: 'state', code: 'code' }],
  ] as const;
  return Promise.all(uses.map(([name, input]) => h.call(operationNamed(h.operations, name), ada, input, at)));
}

describe('reconnecting a connection its server refused', () => {
  it('answers it broken with a new link, which connects it again with the credential the page gives, forgetting the one before', async () => {
    const h = harness();
    const id = await brokenCrm(h);

    const answered = await reconnecting(h, id);
    const link = await reconnected(h, id, aDayAndAMinuteLater);
    const given = await giving(h, link, 'Bearer crm-key-7d2e4b19', aDayAndAMinuteLater);

    expect(answered).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'broken', broken: refusedAsBroken, connect: { expires_at: aDayOn } },
    });
    expect(given).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'connected',
        broken: null,
        connected_at: aDayAndAMinuteLater,
        connected_by: recordedAs.ada,
        credential_ends_with: '4b19',
      },
    });
    expect([...h.secrets.values().values()]).toEqual(['Bearer crm-key-7d2e4b19']);
    expect((await servedAs(sourceOver(h), id)).state.status).toBe('connected');
  });

  it('gives a new link while the one it gave is open, which replaces it, so the five operations of the page refuse the old token and take the new', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const first = await reconnected(h, id);

    const latest = await reconnected(h, id, fiveMinutesLater);

    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_link_issued',
      data: { connection: id, expires_at: '2026-10-16T14:05:00.000Z' },
    });
    expect(await onEveryPageOperation(h, first, fiveMinutesLater)).toEqual(
      Array.from({ length: 5 }, () => replacedLink),
    );
    expect(await reading(h, latest, fiveMinutesLater)).toMatchObject({
      output: { id, status: 'broken', link: { expires_at: latest.expiresAt } },
    });
    expect(await giving(h, latest, 'Bearer crm-key-7d2e4b19', fiveMinutesLater)).toMatchObject({
      output: { id, status: 'connected', credential_ends_with: '4b19' },
    });
  });
});

describe('reconnecting a connection that is connected', () => {
  it('leaves it connected with the credential it holds until the page gives another', async () => {
    const h = harness();
    const id = await connectedCrm(h);

    const link = await reconnected(h, id);
    const before = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
    await giving(h, link, 'Bearer crm-key-7d2e4b19');

    expect(before).toMatchObject({ output: { status: 'connected', credential_ends_with: '9a71' } });
    expect([...h.secrets.values().values()]).toEqual(['Bearer crm-key-7d2e4b19']);
  });

  it('connects one that takes no credential again through approval', async () => {
    const h = harness();
    const first = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: first.id, token: first.token });

    const { id, token } = await reconnected(h, first.id, fiveMinutesLater);
    const approved = await h.call(operationNamed(h.operations, 'approve'), ada, { id, token }, fiveMinutesLater);

    expect(approved).toMatchObject({ output: { status: 'connected', connected_at: fiveMinutesLater } });
  });
});

describe('reconnecting a connection that is pending', () => {
  it('gives a new link once the one before expired, and opens the page with it alone', async () => {
    const h = harness();
    const first = await added(h, crm);

    const link = await reconnected(h, first.id, aDayAndAMinuteLater);

    expect(await reading(h, link, aDayAndAMinuteLater)).toMatchObject({
      output: { status: 'pending', link: { expires_at: link.expiresAt } },
    });
    expect(await reading(h, first, aDayAndAMinuteLater)).toEqual(replacedLink);
  });

  it('gives a new link while the one it was added with is open, and the page refuses that one in words that say a newer link replaced it', async () => {
    const h = harness();
    const first = await added(h, crm);

    const link = await reconnected(h, first.id, fiveMinutesLater);

    expect(await reading(h, link, fiveMinutesLater)).toMatchObject({
      output: { status: 'pending', link: { expires_at: link.expiresAt } },
    });
    expect(await reading(h, first, fiveMinutesLater)).toEqual(replacedLink);
  });
});

describe('reconnecting a connection that is not there to reconnect', () => {
  it('is refused for one removed, and for an id the org does not have', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await reconnecting(h, id)).toMatchObject({
      reason: 'conflict',
      detail: 'The connection notes is removed, so it is added again rather than reconnected',
    });
    expect(await reconnecting(h, 'nowhere')).toMatchObject({ reason: 'not_found' });
  });
});

const localDeveloper: CallerIdentity = { ...ada, id: 'local', name: 'ada' };

describe('who reconnects a connection', () => {
  it('is permitted by org:write alone', async () => {
    const h = harness();
    const id = await brokenCrm(h);

    expect(await h.call(operationNamed(h.operations, 'reconnect_connection'), acmeReader, { id })).toMatchObject({
      reason: 'forbidden',
    });
  });

  it('is the person who added it where people sign in, refusing another person as the page does and a key as adding does', async () => {
    const h = harness({ access: 'people' });
    const id = await brokenCrm(h);
    const key: CallerIdentity = { ...ada, id: 'acme-builder', name: 'acme-builder' };

    const refused = [
      await h.call(operationNamed(h.operations, 'reconnect_connection'), grace, { id }),
      await h.call(operationNamed(h.operations, 'reconnect_connection'), key, { id }),
    ];

    expect(refused).toEqual([
      {
        status: 'rejected',
        reason: 'forbidden',
        detail: 'The connection crm was added by another person, and only they may approve it',
      },
      {
        status: 'rejected',
        reason: 'forbidden',
        detail:
          'A connection is added by a person, through an agent signed in as them, and a key cannot add or reconnect one',
      },
    ]);
    expect(await reconnecting(h, id)).toMatchObject({ status: 'succeeded' });
  });

  it('is the local developer for any connection in local mode', async () => {
    const h = harness({ access: 'local' });
    const { id } = await added(h, crm, { caller: localDeveloper });

    expect(await h.call(operationNamed(h.operations, 'reconnect_connection'), grace, { id })).toMatchObject({
      status: 'succeeded',
    });
  });
});
