import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, billing, crm, notes } from '../testing/additions.ts';
import { acmeWriter, ada, grace, harness, operationNamed, type Harness } from '../testing/harness.ts';

const elevenMinutesLater = '2026-10-15T14:11:00.000Z';

function reading(h: Harness, id: string, token: string, at?: string) {
  return h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token }, at);
}

function approving(h: Harness, id: string, token: string, caller = ada) {
  return h.call(operationNamed(h.operations, 'approve'), caller, { id, token });
}

const noOpenLink = {
  status: 'rejected',
  reason: 'not_found',
  detail: 'There is no open link of this token: it is unknown, used up or expired',
};

describe('reading a link', () => {
  it('answers the connection it names, and when the link expires, to any caller of the org who holds its token', async () => {
    const h = harness();
    const { id, token, expiresAt } = await added(h, crm);

    expect(await reading(h, id, token, '2026-10-15T14:03:00.000Z')).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'pending', link: { expires_at: expiresAt } },
    });
  });

  it('answers the credential of client credentials without a client id where the person gives it on the page', async () => {
    const h = harness();
    const credential = { kind: 'client_credentials', issuer: 'https://auth.billing.example.com' };
    const { id, token } = await added(h, { ...billing, credential });

    const read = await reading(h, id, token);

    expect(read).toMatchObject({ output: { credential } });
    expect(read).not.toHaveProperty('output.credential.client_id');
  });

  it('answers not found for a token that is unknown, of another connection or expired', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    const other = await added(h, notes);

    expect(await reading(h, id, 'unknown')).toEqual(noOpenLink);
    expect(await reading(h, id, other.token)).toEqual(noOpenLink);
    expect(await reading(h, id, token, elevenMinutesLater)).toEqual(noOpenLink);
    expect(await reading(h, 'nowhere', token)).toMatchObject({ reason: 'not_found' });
  });
});

describe('reading the link of a connection whose credential is not consent', () => {
  it('asks the consent client for no client source, where its addition asked with the base of the Studio its link opens', async () => {
    const studioBases: string[] = [];
    const { consent } = harness();
    const h = harness({
      consent: {
        ...consent,
        hadSources: (studioBase) => {
          studioBases.push(studioBase);
          return consent.hadSources(studioBase);
        },
      },
    });
    const { id, token } = await added(h, crm);
    const askedByTheAddition = [...studioBases];

    await reading(h, id, token);

    expect([askedByTheAddition, studioBases]).toEqual([['https://studio.on.auto/'], ['https://studio.on.auto/']]);
  });
});

describe('approving a connection', () => {
  it('connects one that takes no credential to give, and uses its link up', async () => {
    const h = harness({ policy: connectionPolicyOf({ variables: ['NOTES_API_KEY'] }) });
    const { id, token } = await added(h, notes);
    const reference = await added(h, {
      ...notes,
      name: 'notes-key',
      credential: { kind: 'reference', variable: 'NOTES_API_KEY', name: 'Authorization', in: 'header' },
    });

    const approved = await approving(h, id, token);

    expect(approved).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'connected', connected_at: '2026-10-15T14:00:00.000Z' },
    });
    expect(await approving(h, reference.id, reference.token)).toMatchObject({ output: { status: 'connected' } });
    expect(approved).not.toHaveProperty('output.link');
    expect(await approving(h, id, token)).toEqual(noOpenLink);
    expect((await h.facts()).slice(4, 6).map(({ type, data }) => [type, data])).toEqual([
      ['connection_approved', { connection: id }],
      ['connection_connected', { connection: id, connected_by: { id: 'person:ada', name: 'Ada Lovelace' } }],
    ]);
  });

  it('refuses one whose credential is to be given, with a conflict that says so', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await approving(h, id, token)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The connection crm takes a credential, so it is approved by giving its credential',
    });
  });

  it('is refused to another person where sign-in is on, and taken from the token alone where it is not', async () => {
    const signedIn = harness();
    const local = harness({ access: 'local' });
    const there = await added(signedIn, notes);
    const here = await added(local, notes);

    expect(await approving(signedIn, there.id, there.token, grace)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The connection notes was added by another person, and only they may approve it',
    });
    expect(await approving(local, here.id, here.token, grace)).toMatchObject({ output: { status: 'connected' } });
  });
});

describe('the person who may approve a connection where sign-in is on', () => {
  it('is the person who added it by their id, whatever name they sign in with now', async () => {
    const h = harness();
    const { id, token } = await added(h, notes);

    expect(await approving(h, id, token, { ...ada, name: 'Ada King' })).toMatchObject({
      output: { status: 'connected', added_by: { id: 'person:ada', name: 'Ada Lovelace' } },
    });
  });
});
