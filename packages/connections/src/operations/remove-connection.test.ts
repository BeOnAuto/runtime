import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { admitted, registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
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

async function connectedByConsentAt(fake: FakeMcpServer, fetch: ConsentClientOptions['fetch'] = globalThis.fetch) {
  const h = consentHarnessAt(fake, { consenting: { registeredClients: [registeredAt(fake.origin)], fetch } });
  const link = await added(h, { provider: 'files' });
  await finishing(h, link, await consentedOf(h, link));
  const [row = ''] = h.secrets.values().values();
  return { h, id: link.id, tokens: tokensIn(row) };
}

interface Sending {
  token: string;
}

function revocationsFailingWhile(sending: Readonly<Sending>): ConsentClientOptions['fetch'] {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).endsWith('/revoke')
      ? Promise.reject(new Error(`The connection reset while it sent ${sending.token}`))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

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
  it('goes on to forget the row, and logs why in words that hold no token', async () => {
    const fake = await consentServed();
    const sending: Sending = { token: '' };
    const { h, id, tokens } = await connectedByConsentAt(fake, revocationsFailingWhile(sending));
    sending.token = tokens.refresh_token;

    const removed = await removing(h, id);

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(h.secrets.values().size).toBe(0);
    expect(h.logged().join('\n')).toContain(
      'The tokens of the connection files were not revoked at its authorization server, so they end on their own: The connection reset while it sent [redacted]',
    );
    expect(h.logged().join('\n')).not.toContain(tokens.refresh_token);
  });

  it('goes on where the authorization server does not answer, and logs that in the words of a consent', async () => {
    const fake = await consentFake();
    const { h, id } = await connectedByConsentAt(fake);
    await fake.close();

    const removed = await removing(h, id);

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(h.logged().join('\n')).toContain(
      'The tokens of the connection files were not revoked at its authorization server, so they end on their own: The authorization server of the connection files did not answer as an authorization server does; try again in a moment',
    );
  });
});
