import { messages, providerListOf, providerOf } from '@on.auto/providers/testing';
import { consentClientWith } from '@on.auto/tool-servers/testing';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { adding } from '../testing/additions.ts';
import { gatewayHarnessAt, gatewayServed } from '../testing/gateways.ts';
import { ada, harness, harnessPages, operationNamed } from '../testing/harness.ts';

const notHere =
  "The provider messages connects through a service that Auto's cloud runs, which this runtime does not have";

const listedWay = {
  kind: 'authorization',
  in: 'security',
  name: 'connection_key',
  issuer: 'https://messages.example.com',
  permissions: 'application',
  scopes: [
    { name: 'messages:read', says: 'Read the messages of the workspace.' },
    { name: 'messages:write', says: 'Post messages in the workspace.' },
  ],
  more: [],
  description: 'Add the app to your workspace.',
};

function listingWith(gateways: boolean, providers = providerListOf(providerOf(messages))) {
  const h = harness({ providers, consenting: { gateways } });
  return h.call(operationNamed(h.operations, 'list_providers'), ada);
}

function offeredWith(gateways: boolean) {
  return Effect.runPromise(
    makeProviderOffering({
      providers: providerListOf(providerOf(messages)),
      providerValues: new Map(),
      policy: connectionPolicyOf({}),
      access: 'people',
      pages: harnessPages,
      consent: consentClientWith({ gateways }),
    })(ada),
  );
}

describe('a provider that connects through a gateway', () => {
  it('is offered with the gateway as the source of its client where gateways are switched on, acting as the app as its entry declares, and never under the organization’s own OAuth client', async () => {
    expect(await listingWith(true)).toMatchObject({
      output: {
        providers: [{ name: 'messages', credentials: [{ ...listedWay, offered: true, client_source: 'gateway' }] }],
      },
    });
    expect(await offeredWith(true)).toEqual([
      {
        name: 'messages',
        title: 'Messages',
        description: 'Read and post the messages of a workspace, as the app added to it.',
      },
    ]);
  });

  it('is not offered where gateways are not switched on, saying why, and is left out of what search offers', async () => {
    const listed = await listingWith(false);

    expect(listed).toMatchObject({
      output: { providers: [{ name: 'messages', credentials: [{ ...listedWay, offered: false, because: notHere }] }] },
    });
    expect(JSON.stringify(listed)).not.toContain('oauth_client');
    expect(JSON.stringify(listed)).not.toContain('audiences');
    expect(await offeredWith(false)).toEqual([]);
  });
});

describe('a provider that connects through a gateway and sends a value whoever runs the runtime sets', () => {
  it('says first what whoever runs the runtime must set up, where the value is not set', async () => {
    const sending = providerOf({ ...messages, headers: { 'X-Client': '${MESSAGES_CLIENT}' } });

    expect(await listingWith(true, providerListOf(sending))).toMatchObject({
      output: {
        providers: [
          {
            credentials: [
              {
                offered: false,
                because:
                  'Whoever runs the runtime sets this up first: it sends MESSAGES_CLIENT, which this runtime does not set',
              },
            ],
          },
        ],
      },
    });
    const h = harness({
      providers: providerListOf(sending),
      providerValues: new Map([['MESSAGES_CLIENT', Redacted.make('acme')]]),
      consenting: { gateways: true },
    });
    expect(await h.call(operationNamed(h.operations, 'list_providers'), ada)).toMatchObject({
      output: { providers: [{ credentials: [{ offered: true, client_source: 'gateway' }] }] },
    });
  });
});

describe('the addition of a provider that connects through a gateway', () => {
  it('is refused where gateways are not switched on, in the words the listing gives, and records nothing', async () => {
    const h = harness({ providers: providerListOf(providerOf(messages)), consenting: { gateways: false } });

    expect(await adding(h, { provider: 'messages' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/provider', detail: notHere }],
    });
    expect(await h.facts()).toEqual([]);
  });

  it('is refused with the organization’s own OAuth client, which the gateway never takes', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);

    expect(
      await adding(h, { provider: 'messages', credential: { kind: 'authorization', oauth_client: 'own' } }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/credential/oauth_client',
          detail:
            'Expected no oauth_client: the provider messages connects through a gateway, which makes the consent with a client of its own',
        },
      ],
    });
  });

  it('records the gateway as the source of its client, and the security scheme its key is sent under', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);

    await adding(h, { provider: 'messages' });

    expect((await h.facts()).at(0)).toMatchObject({
      type: 'connection_added',
      data: {
        provider: 'messages',
        credential: { kind: 'authorization', client_source: 'gateway', in: 'security', name: 'connection_key' },
      },
    });
  });
});

describe('a server given by hand that names a gateway as the source of its client', () => {
  it('is refused as it is added, since only a provider’s entry names a gateway, and nothing is recorded', async () => {
    const h = harness();
    const throughAGateway = { kind: 'authorization', client_source: 'gateway', in: 'security', name: 'key' };

    expect(
      await adding(h, {
        name: 'relay',
        type: 'mcp',
        entry: { url: 'https://relay.example.com/mcp' },
        credential: throughAGateway,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/credential/client_source', detail: 'Expected no excess property' }],
    });
    expect(await h.facts()).toEqual([]);
  });
});

describe('a server given by hand at the address of a gateway', () => {
  it('is refused as it is added, naming the provider that connects through it', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);

    expect(
      await adding(h, {
        name: 'relay',
        type: 'mcp',
        entry: { url: `${gateway.origin}/mcp` },
        credential: { kind: 'none' },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: `A connection given by hand may not reach ${gateway.origin}, which the provider messages connects through; add the provider messages instead`,
    });
  });
});

const servedElsewhere = 'https://docs.example.com/openapi.json';

function documentNaming(server: string): typeof globalThis.fetch {
  const text = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Relay', version: '1' },
    servers: [{ url: server }],
    paths: { '/whoami': { get: { operationId: 'who_am_i', summary: 'Says who the caller is.' } } },
  });
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address) === servedElsewhere
      ? Promise.resolve(new Response(text, { headers: { 'content-type': 'application/json' } }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

describe('an HTTP API given by hand whose document names a gateway as its server', () => {
  it('is refused as it is added, once its document is read, and nothing is recorded', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway, {
      fetch: documentNaming(`${gateway.origin}/api`),
      policy: connectionPolicyOf({ allowed_hosts: ['127.0.0.1', 'docs.example.com'] }),
    });

    expect(
      await adding(h, {
        name: 'relay',
        type: 'openapi',
        entry: { document: servedElsewhere },
        credential: { kind: 'none' },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: `A connection given by hand may not reach ${gateway.origin}, which the provider messages connects through; add the provider messages instead`,
    });
    expect(await h.facts()).toEqual([]);
  });
});
