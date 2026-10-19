import { calledOpeningLinks } from '@on.auto/api/testing';
import { hostAlternativesOf, operatorVariablesIn, type Provider } from '@on.auto/providers';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { required, shippedList, shippedProviders } from '../testing/servers/connected-servers.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

const names = shippedProviders.map(({ entry }) => entry.name);

const ListedSchema = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ name: Schema.String })),
  may_add: Schema.Boolean,
  refusal: Schema.NullOr(Schema.String),
});

function hostsOf(provider: Provider): readonly (readonly string[])[] {
  return provider.entry.credentials.flatMap((way) => hostAlternativesOf(provider, way));
}

function placementOf({ entry }: Provider) {
  const { kind, in: placedIn, name, scheme } = required(entry.credentials[0]);
  return { kind, in: placedIn, name, scheme };
}

const addedByName = shippedProviders.filter(
  ({ entry }) => entry.type === 'mcp' && entry.placeholders === undefined && entry.credentials[0]?.kind === 'secret',
);

const refusedName = 'There is no provider named crm here; search lists the providers a person may connect';

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([]);
});

afterAll(async () => {
  await server.stop();
});

async function namesListedBy(served: ReasoningServer): Promise<readonly string[]> {
  const { body } = await served.call('GET', '/v1/orgs/local/providers');
  return Schema.decodeUnknownSync(ListedSchema)(body).providers.map(({ name }) => name);
}

describe('the providers a server lists over HTTP', () => {
  it('are the providers it ships, sorted by name, which the local developer may add', async () => {
    const answer = await server.call('GET', '/v1/orgs/local/providers');

    expect(answer).toMatchObject({ status: 200, body: { may_add: true, refusal: null } });
    expect(await namesListedBy(server)).toEqual(names);
    expect(names.length).toBeGreaterThan(0);
  });

  it('are those the rules of its operator could allow', async () => {
    const allowed = required(hostsOf(required(shippedProviders[0]))[0]);
    const reached = shippedProviders.filter((provider) =>
      hostsOf(provider).some((hosts) => hosts.every((host) => allowed.includes(host))),
    );
    const served = await servingReasoning([], { CONNECTIONS: JSON.stringify({ allowed_hosts: allowed }) });
    onTestFinished(() => served.stop());

    expect(await namesListedBy(served)).toEqual(reached.map(({ entry }) => entry.name));
    expect(reached.length).toBeLessThan(names.length);
  });

  it('take no name a built-in model provider has, which every runtime would refuse a connection', () => {
    const { modelProviders } = readSettings({});

    expect(names.filter((name) => modelProviders.includes(name))).toEqual([]);
    expect(modelProviders.length).toBeGreaterThan(5);
  });

  it('refer to no variable the runtime reads for itself, whose value a connection would send to the vendor', () => {
    expect(operatorVariablesIn(shippedList).filter((name) => variablesTheRuntimeReads.includes(name))).toEqual([]);
    expect(variablesTheRuntimeReads.length).toBeGreaterThan(10);
  });
});

describe('a connection added by a provider', () => {
  it('is added over HTTP by its name alone, with the server and the credential the provider gives', async () => {
    const provider = required(addedByName[0]);
    const { name, url } = provider.entry;

    const answer = await server.call('POST', '/v1/orgs/local/connections', { body: { provider: name } });

    expect(answer).toMatchObject({
      status: 201,
      body: {
        name,
        type: 'mcp',
        provider: name,
        placeholders: {},
        entry: { url },
        credential: placementOf(provider),
        status: 'pending',
      },
    });
  });

  it('is added over MCP by its name, and a provider the server has not is refused at /provider', async () => {
    const { name, url } = required(addedByName.at(-1)).entry;
    const connection = { url: `${server.origin}/mcp`, headers: {} };

    const { answer } = await calledOpeningLinks(connection, {
      name: 'add_connection',
      arguments: { provider: name, name: 'added-over-mcp' },
    });
    const refused = await server.call('POST', '/v1/orgs/local/connections', { body: { provider: 'crm' } });

    expect(answer.structuredContent).toMatchObject({
      name: 'added-over-mcp',
      provider: name,
      placeholders: {},
      entry: { url },
    });
    expect(refused).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [{ pointer: '/provider', detail: refusedName }],
      },
    });
  });
});
