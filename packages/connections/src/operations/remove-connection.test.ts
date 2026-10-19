import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { admitted, hostRefusedAt, registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, notes } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, finishing } from '../testing/consents.ts';
import { acmeReader, ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const tokensIn = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String })),
);

function removing(h: Harness, id: string, caller = ada) {
  return h.call(operationNamed(h.operations, 'remove_connection'), caller, { id });
}

function revocationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/revoke').length;
}

async function connectedByConsentAt(fake: FakeMcpServer, consenting: Partial<ConsentClientOptions> = {}) {
  const h = consentHarnessAt(fake, { consenting: { registeredClients: [registeredAt(fake.origin)], ...consenting } });
  const link = await added(h, { provider: 'files' });
  await finishing(h, link, await consentedOf(h, link));
  const [row = ''] = h.secrets.values().values();
  return { h, id: link.id, tokens: tokensIn(row) };
}

interface Sending {
  token: string;
}

function revocationsAnswering(answer: () => Promise<Response>): ConsentClientOptions['fetch'] {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).endsWith('/revoke') ? answer() : globalThis.fetch(String(address), Object.assign({}, init));
}

function failingWhileSending(sending: Readonly<Sending>): () => Promise<Response> {
  return () => Promise.reject(new Error(`The connection reset while it sent ${sending.token}`));
}

async function loggedRemovalOf(h: Harness, id: string): Promise<string> {
  const removed = await removing(h, id);
  expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
  expect(h.secrets.values().size).toBe(0);
  return h.logged().join('\n');
}

const unanswered =
  'The authorization server of the connection files did not answer the revocation of its tokens, so they end on their own';

async function consentServed(): Promise<FakeMcpServer> {
  const fake = await consentFake();
  closing.push(fake.close);
  return fake;
}

describe('removing a connection', () => {
  it('answers it removed, closes its link and forgets its credential, which the store held alone', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'Bearer crm-0f3c' });
    const keptBefore = [...h.secrets.values().values()];

    const removed = await removing(h, id);

    expect(keptBefore).toEqual(['Bearer crm-0f3c']);
    expect(removed).toMatchObject({ status: 'succeeded', output: { id, status: 'removed' } });
    expect(h.secrets.values().size).toBe(0);
    expect((await h.facts()).at(-1)).toMatchObject({ type: 'connection_removed', context: { by: 'person:ada' } });
    expect(await h.call(operationNamed(h.operations, 'read_link'), ada, { id, token })).toMatchObject({
      reason: 'not_found',
    });
  });

  it('records nothing when the connection is removed already, and refuses an id the org does not have', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await removing(h, id);
    const factsBefore = (await h.facts()).length;

    expect(await removing(h, id)).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect((await h.facts()).length).toBe(factsBefore);
    expect(await removing(h, 'nowhere')).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });

  it('is permitted by org:write alone', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    expect(await removing(h, id, acmeReader)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('removing a connection connected by consent', () => {
  it('revokes its tokens with the client it was made with, then forgets their row', async () => {
    const fake = await consentServed();
    const { h, id, tokens } = await connectedByConsentAt(fake);

    const removed = await removing(h, id);

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(await admitted(fake, tokens.access_token)).toBe(false);
    expect(revocationsAt(fake)).toBe(1);
    expect(h.secrets.values().size).toBe(0);
  });

  it('revokes nothing more when it is removed again, nor for a connection still pending', async () => {
    const fake = await consentServed();
    const { h, id } = await connectedByConsentAt(fake);
    const pending = await added(h, { provider: 'files', name: 'drafts' });

    await removing(h, id);
    await removing(h, id);
    await removing(h, pending.id);

    expect(revocationsAt(fake)).toBe(1);
  });
});

describe('a removal whose revocation does not happen', () => {
  it('goes on to forget the row where the request fails, and logs that it was not answered in words that hold no token', async () => {
    const fake = await consentServed();
    const sending: Sending = { token: '' };
    const { h, id, tokens } = await connectedByConsentAt(fake, {
      fetch: revocationsAnswering(failingWhileSending(sending)),
    });
    sending.token = tokens.refresh_token;

    const logged = await loggedRemovalOf(h, id);

    expect(logged).toContain(unanswered);
    expect(logged).not.toContain(tokens.refresh_token);
  });

  it('goes on where the authorization server does not answer at all, or refuses the revocation', async () => {
    const gone = await consentFake();
    const refusing = await consentServed();
    const unanswering = await connectedByConsentAt(gone);
    const refused = await connectedByConsentAt(refusing, {
      fetch: revocationsAnswering(() => Promise.resolve(new Response(null, { status: 503 }))),
    });
    await gone.close();

    const loggedUnanswered = await loggedRemovalOf(unanswering.h, unanswering.id);
    const loggedRefused = await loggedRemovalOf(refused.h, refused.id);

    expect(loggedUnanswered).toContain(unanswered);
    expect(loggedRefused).toContain(
      'The authorization server of the connection files refused to revoke its tokens, answering HTTP 503, so they end on their own',
    );
  });
});

describe('a removal whose revocation cannot be made', () => {
  it('goes on where the rules refuse the host it reaches, or the client the connection was made with is gone', async () => {
    const fake = await consentServed();
    const rule = 'The rules of whoever runs Auto do not allow the host 127.0.0.1';
    const registered = [registeredAt(fake.origin)];
    const refusedItsHost = await connectedByConsentAt(fake, {
      fetch: hostRefusedAt('/revoke', rule),
    });
    const withoutItsClient = await connectedByConsentAt(fake, { registeredClients: registered });
    registered.splice(0, 1, registeredAt(fake.origin, { clientId: 'renamed' }));

    const loggedHost = await loggedRemovalOf(refusedItsHost.h, refusedItsHost.id);
    const loggedClient = await loggedRemovalOf(withoutItsClient.h, withoutItsClient.id);

    expect(loggedHost).toContain(
      `The tokens of the connection files were not revoked, so they end on their own: ${rule}`,
    );
    expect(loggedClient).toContain(
      'The tokens of the connection files could not be revoked with the client and at the authorization server it was made with, so they end on their own',
    );
  });
});
