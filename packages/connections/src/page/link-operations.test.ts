import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import type { RecordedConnectionEvent } from '../registry/connection-events.ts';
import { added, billing, crm, notes, reconnected } from '../testing/additions.ts';
import { acmeWriter, ada, grace, harness, operationNamed, type Harness } from '../testing/harness.ts';

const anyWords: unknown = expect.any(String);

function reading(h: Harness, id: string, token: string, at?: string) {
  return h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token }, at);
}

function approving(h: Harness, id: string, token: string, caller = ada) {
  return h.call(operationNamed(h.operations, 'approve'), caller, { id, token });
}

const noOpenLink = {
  status: 'rejected',
  reason: 'not_found',
  detail: anyWords,
};

describe('reading a link', () => {
  it.each(['2026-10-15T14:03:00.000Z', '2026-10-16T14:01:00.000Z', '2031-10-15T14:00:00.000Z'])(
    'answers the connection it names, and its link with nothing of an end, to any caller of the org who holds its token, at %s',
    async (at) => {
      const h = harness();
      const { id, token } = await added(h, crm);

      const read = await reading(h, id, token, at);

      expect(read).toMatchObject({ status: 'succeeded', output: { id, status: 'pending' } });
      expect(read).toHaveProperty('output.link', {});
    },
  );

  it('answers the credential of client credentials without a client id where the person gives it on the page', async () => {
    const h = harness();
    const credential = { kind: 'client_credentials', issuer: 'https://auth.billing.example.com' };
    const { id, token } = await added(h, { ...billing, credential });

    const read = await reading(h, id, token);

    expect(read).toMatchObject({ output: { credential } });
    expect(read).not.toHaveProperty('output.credential.client_id');
  });

  it('answers not found for a token that is unknown or of another connection', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    const other = await added(h, notes);

    expect(await reading(h, id, 'unknown')).toEqual(noOpenLink);
    expect(await reading(h, id, other.token)).toEqual(noOpenLink);
    expect(await reading(h, 'nowhere', token)).toMatchObject({ reason: 'not_found' });
  });
});

const anAgentsClient = { id: 'https://agent.example/oauth/client.json', name: 'An agent', domain: 'agent.example' };

const anotherAgentsClient = { id: 'f7d3b2a1', name: 'Another agent', domain: null };

function linksIssuedIn(facts: readonly RecordedConnectionEvent[]) {
  return facts.flatMap((fact) => (fact.type === 'connection_link_issued' ? [fact.data] : []));
}

describe('the client a link was asked through', () => {
  it('is recorded with the link of an addition the person makes through a client, and answered with that link', async () => {
    const h = harness();
    const { id, token } = await added(h, crm, { caller: { ...ada, client: anAgentsClient } });
    const facts = await h.facts();

    expect(linksIssuedIn(facts)).toEqual([expect.objectContaining({ asked_by: anAgentsClient })]);
    expect(facts.find(({ type }) => type === 'connection_added')?.data).not.toHaveProperty('asked_by');
    expect(await reading(h, id, token)).toMatchObject({ output: { id, asked_by: anAgentsClient } });
  });

  it('is answered for a client its token names no name or domain of, by its client ID alone', async () => {
    const h = harness();
    const unnamed = { id: 'f7d3b2a1', name: null, domain: null };
    const { id, token } = await added(h, crm, { caller: { ...ada, client: unnamed } });

    expect(await reading(h, id, token)).toMatchObject({ output: { asked_by: unnamed } });
  });

  it.each([
    ['a person whose call names no client', 'people', ada],
    ['a key, where the runtime lets one add a connection', 'local', acmeWriter],
  ] as const)('is none, recorded and answered, for %s', async (_case, access, caller) => {
    const h = harness({ access });
    const { id, token } = await added(h, crm, { caller });

    expect(linksIssuedIn(await h.facts())[0]).not.toHaveProperty('asked_by');
    expect(await reading(h, id, token)).not.toHaveProperty('output.asked_by');
  });
});

describe('the client a new link was asked through', () => {
  it('is the one each new link was asked through, whoever asked for the link before it', async () => {
    const h = harness();
    const { id } = await added(h, crm, { caller: { ...ada, client: anAgentsClient } });
    const throughAnother = await reconnected(h, id, undefined, { ...ada, client: anotherAgentsClient });
    const throughNone = await reconnected(h, id);

    expect(linksIssuedIn(await h.facts()).map((link) => link.asked_by)).toEqual([
      anAgentsClient,
      anotherAgentsClient,
      undefined,
    ]);
    expect(await reading(h, id, throughNone.token)).not.toHaveProperty('output.asked_by');
    expect(await reading(h, id, throughAnother.token)).toMatchObject({ reason: 'not_found' });
  });

  it('is answered for a new link, as the call that gave it named it', async () => {
    const h = harness();
    const { id } = await added(h, crm);
    const { token } = await reconnected(h, id, undefined, { ...ada, client: anotherAgentsClient });

    expect(await reading(h, id, token)).toMatchObject({ output: { asked_by: anotherAgentsClient } });
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

  it('is taken from the token alone, whoever added the connection', async () => {
    const h = harness();
    const { id, token } = await added(h, notes);

    expect(await approving(h, id, token, grace)).toMatchObject({
      output: { status: 'connected', added_by: { id: 'person:ada' }, connected_by: { id: 'person:grace' } },
    });
  });
});
