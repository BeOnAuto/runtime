import { keyMadeAt, providerListOf, providerOf } from '@on.auto/providers/testing';
import type { FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, lastFact, reconnected, type Added } from '../testing/additions.ts';
import { readingTheLink } from '../testing/by-hand.ts';
import {
  consentedOf,
  consentHarnessAt,
  filesAt,
  finishing,
  givingTheClient,
  orgsOAuthClientFake,
  startedAt,
  underTheOrgsOAuthClient,
} from '../testing/consents.ts';
import { allowedAt, connectedThrough, finishingWith, gatewayHarnessAt, gatewayServed } from '../testing/gateways.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const ListedSchema = Schema.Struct({
  output: Schema.Struct({ connections: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
});

async function listedAs(h: Harness, { id }: Added): Promise<unknown> {
  const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada, {});
  return Schema.decodeUnknownSync(ListedSchema)(listed).output.connections.find((each) => each['id'] === id);
}

function onItsLink(h: Harness, name: string, { id, token }: Added, input: Readonly<Record<string, unknown>> = {}) {
  return h.call(operationNamed(h.operations, name), ada, { id, token, ...input });
}

async function typesSince(h: Harness, count: number): Promise<readonly string[]> {
  return (await h.facts()).slice(count).map(({ type }) => type);
}

function heldSecrets(h: Harness): readonly string[] {
  return [...h.secrets.values().values()];
}

const deskKey = {
  kind: 'secret',
  in: 'header',
  name: 'Authorization',
  scheme: 'Bearer',
  ...keyMadeAt('app.desk.example.com'),
};

const desk = providerListOf(
  providerOf({
    name: 'desk',
    title: 'Desk',
    description: 'Read the tickets of a help desk.',
    website: 'https://developer.desk.example.com',
    type: 'mcp',
    url: 'https://mcp.desk.example.com/mcp',
    credentials: [deskKey, { ...deskKey, permissions: 'application' }, { kind: 'none' }],
  }),
);

async function connectedWithAKey(h: Harness, input: unknown, value: string): Promise<Added> {
  const link = await added(h, input);
  await onItsLink(h, 'give_credential', link, { value });
  return link;
}

describe('a connection that has connected, reconnected another way', () => {
  it('keeps its way and its key until the way chosen connects, then takes that way and forgets the key', async () => {
    const h = harness({ providers: desk });
    const first = await connectedWithAKey(h, { provider: 'desk', credential: { kind: 'secret' } }, 'desk-key-0f3c');
    const link = await reconnected(h, first.id);

    const chosen = await onItsLink(h, 'choose_way', link, { credential: { kind: 'none' } });
    const meanwhile = [await listedAs(h, link), heldSecrets(h), await readingTheLink(h, link), await lastFact(h)];
    const before = (await h.facts()).length;
    const approved = await onItsLink(h, 'approve', link);

    expect(chosen).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: { kind: 'none' } },
    });
    expect(meanwhile).toMatchObject([
      { status: 'connected', credential: { kind: 'secret' }, account_type: 'personal' },
      ['desk-key-0f3c'],
      { output: { credential: { kind: 'none' }, account_type: null } },
      { connection: link.id, credential: { kind: 'none' } },
    ]);
    expect(approved).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: { kind: 'none' } },
    });
    expect(await typesSince(h, before)).toEqual([
      'connection_way_chosen',
      'connection_approved',
      'connection_connected',
    ]);
    expect([await listedAs(h, link), heldSecrets(h)]).toMatchObject([{ credential: { kind: 'none' } }, []]);
  });

  it('records nothing for the way it has, its values and its account type, so its page signs it in again that way', async () => {
    const h = harness({ providers: desk });
    const first = await connectedWithAKey(h, { provider: 'desk', credential: { kind: 'secret' } }, 'desk-key-0f3c');
    const link = await reconnected(h, first.id);
    const before = await h.facts();

    const chosen = await onItsLink(h, 'choose_way', link, { credential: { kind: 'secret' }, account_type: 'personal' });

    expect(chosen).toMatchObject({ status: 'succeeded', output: { credential: { kind: 'secret' } } });
    expect(await h.facts()).toEqual(before);
  });
});

const filesKey = { kind: 'secret', in: 'header', name: 'X-Files-Key', ...keyMadeAt('app.files.example.com') };

function filesWithAKey(fake: FakeMcpServer) {
  const { entry } = filesAt(fake);
  return providerListOf(providerOf({ ...entry, credentials: [...entry.credentials, filesKey] }));
}

function revocationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/revoke').length;
}

async function signedInUnderItsOwnClient() {
  const fake = orgsOAuthClientFake();
  closing.push(fake.close);
  const h = consentHarnessAt(fake, { providers: filesWithAKey(fake) });
  const first = await added(h, underTheOrgsOAuthClient);
  await givingTheClient(h, first);
  await finishing(h, first, await consentedOf(h, first));
  return { fake, h, held: heldSecrets(h), link: await reconnected(h, first.id) };
}

describe('a connection signed in under the organization’s own OAuth client, reconnected with a key', () => {
  it('keeps its tokens and its client until the key is given, then revokes the tokens and forgets the client', async () => {
    const { fake, h, held, link } = await signedInUnderItsOwnClient();

    await onItsLink(h, 'choose_way', link, { credential: { kind: 'secret' } });
    const meanwhile = [heldSecrets(h), revocationsAt(fake), await listedAs(h, link)];
    const given = await onItsLink(h, 'give_credential', link, { value: 'files-key-7d2e' });

    expect(held).toHaveLength(2);
    expect(meanwhile).toMatchObject([held, 0, { credential: { kind: 'authorization', client_id: 'org-app' } }]);
    expect(given).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: { kind: 'secret' } },
    });
    expect([revocationsAt(fake), heldSecrets(h)]).toEqual([1, ['files-key-7d2e']]);
  });
});

describe('a connection signed in under the organization’s own OAuth client, reconnected as another account type', () => {
  it('keeps its client for the sign-in, and forgets the tokens it held without revoking them once it is connected', async () => {
    const { fake, h, held, link } = await signedInUnderItsOwnClient();
    const [, tokens] = held;

    await onItsLink(h, 'choose_way', link, { credential: { kind: 'authorization' }, account_type: 'service' });
    const read = await readingTheLink(h, link);
    const finished = await finishing(h, link, await consentedOf(h, link));

    expect(read).toMatchObject({ output: { account_type: 'service', credential: { client_id: 'org-app' } } });
    expect(finished).toMatchObject({ status: 'succeeded', output: { status: 'connected', account_type: 'service' } });
    expect(revocationsAt(fake)).toBe(0);
    expect(heldSecrets(h)).toHaveLength(2);
    expect(heldSecrets(h)).not.toContain(tokens);
  });
});

async function connectedByKeyAtFiles() {
  const fake = orgsOAuthClientFake();
  closing.push(fake.close);
  const h = consentHarnessAt(fake, { providers: filesWithAKey(fake), consenting: { registeredClients: [] } });
  const first = await connectedWithAKey(h, { provider: 'files', credential: { kind: 'secret' } }, 'files-key-7d2e');
  const link = await reconnected(h, first.id);
  await onItsLink(h, 'choose_way', link, { credential: { kind: 'authorization' } });
  const client = await givingTheClient(h, link);
  await startedAt(h, link);
  return { h, link, client };
}

describe('the sign-in of a way chosen for a connection connected by a key', () => {
  it('answers the client given for the way chosen, and is let go of when another way is chosen', async () => {
    const { h, link, client } = await connectedByKeyAtFiles();
    const held = heldSecrets(h);

    await onItsLink(h, 'choose_way', link, { credential: { kind: 'secret' } });

    expect(client).toMatchObject({ output: { credential: { kind: 'authorization', client_id: 'org-app' } } });
    expect(client).not.toHaveProperty(['output', 'next_client_id']);
    expect(held).toHaveLength(3);
    expect(heldSecrets(h)).toEqual(['files-key-7d2e']);
  });

  it('is let go of with the connection when it is removed', async () => {
    const { h, link } = await connectedByKeyAtFiles();

    const removed = await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(removed).toMatchObject({ status: 'succeeded' });
    expect(heldSecrets(h)).toEqual([]);
  });
});

const throughTheGateway = { kind: 'authorization', permissions: 'application' } as const;

function messagesThroughOrWithNoCredential({ url, document }: ReturnType<typeof gatewayServed>) {
  const { origin } = new URL(url);
  return providerListOf(
    providerOf({
      name: 'messages',
      title: 'Messages',
      description: 'Read and post the messages of a workspace.',
      website: 'https://developer.messages.example.com',
      type: 'openapi',
      document,
      credentials: [
        {
          kind: 'authorization',
          issuer: 'https://messages.example.com',
          scope: 'messages:read',
          says: { 'messages:read': 'Read the messages of the workspace.' },
          gateway: { url, audiences: { connections: origin, calls: `${origin}/api` }, claims: ['name'] },
          permissions: 'application',
          in: 'security',
          name: 'connection_key',
        },
        { kind: 'none' },
      ],
    }),
  );
}

async function connectedThroughTheGateway() {
  const gateway = gatewayServed();
  const h = gatewayHarnessAt(gateway, { providers: messagesThroughOrWithNoCredential(gateway) });
  const first = await added(h, { provider: 'messages', credential: { kind: 'authorization' } });
  const { link } = await connectedThrough(h, gateway, first);
  return { gateway, h, link: await reconnected(h, link.id) };
}

describe('a connection connected through its gateway, reconnected another way', () => {
  it('ends the key it held at the gateway once the way chosen connects', async () => {
    const { gateway, h, link } = await connectedThroughTheGateway();
    const [key = ''] = gateway.keys();

    await onItsLink(h, 'choose_way', link, { credential: { kind: 'none' } });
    const meanwhile = gateway.ended();
    const approved = await onItsLink(h, 'approve', link);

    expect(meanwhile).toEqual([]);
    expect(approved).toMatchObject({ status: 'succeeded', output: { credential: { kind: 'none' } } });
    expect([gateway.ended(), heldSecrets(h)]).toEqual([[key], []]);
  });

  it('signs in through the gateway again where its own way is chosen after another', async () => {
    const { gateway, h, link } = await connectedThroughTheGateway();
    await onItsLink(h, 'choose_way', link, { credential: { kind: 'none' } });
    await onItsLink(h, 'choose_way', link, { credential: throughTheGateway });

    const finished = await finishingWith(h, link, await allowedAt(h, gateway, link));

    expect(finished).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(gateway.keys()).toHaveLength(1);
    expect(gateway.ended()).toHaveLength(1);
  });
});
