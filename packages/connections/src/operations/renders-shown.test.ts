import { fixtureProviders, providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added } from '../testing/additions.ts';
import { acmeReader, ada, harness, harnessPages, operationNamed } from '../testing/harness.ts';

const anyRenders: unknown = expect.any(String);

function withoutRenders(): unknown {
  return expect.not.objectContaining({ renders: anyRenders });
}

const cards = providerOf({ ...tracker, renders: 'cards' });

const providers = providerListOf(...fixtureProviders.providers.filter(({ entry }) => entry.name !== 'tracker'), cards);

const tracked = { provider: 'tracker', placeholders: { site: 'acme' }, credential: { kind: 'none' } };

const unrendered = {
  name: 'notes',
  type: 'mcp',
  entry: { url: 'https://notes.example.com/mcp' },
  credential: { kind: 'none' },
};

describe('the render target of the provider of a connection', () => {
  it('is answered by add_connection, list_connections and get_connection, and by none for a connection given by hand', async () => {
    const h = harness({ providers });
    const adding = operationNamed(h.operations, 'add_connection');
    const addedByProvider = await h.call(adding, ada, tracked);
    const addedByHand = await h.call(adding, ada, unrendered);
    const { id } = await added(h, { ...tracked, name: 'more-tracking' });

    expect([addedByProvider, addedByHand]).toMatchObject([
      { status: 'succeeded', output: { renders: 'cards' } },
      { status: 'succeeded', output: withoutRenders() },
    ]);
    expect(await h.call(operationNamed(h.operations, 'list_connections'), acmeReader, {})).toMatchObject({
      output: {
        connections: [
          { name: 'more-tracking', renders: 'cards' },
          { name: 'notes' },
          { name: 'tracker', renders: 'cards' },
        ],
      },
    });
    expect(await h.call(operationNamed(h.operations, 'get_connection'), acmeReader, { id })).toMatchObject({
      output: { id, renders: 'cards' },
    });
  });

  it('is served with the connection, for the tools of its server to say', async () => {
    const h = harness({ providers });
    await added(h, tracked);
    const source = makeConnectionSource({
      registry: h.ledger.service,
      secrets: h.secrets,
      policy: connectionPolicyOf({}),
      variables: new Map(),
      modelProviders: [],
      providers,
      providerValues: new Map(),
      pages: harnessPages,
    });

    const listed = await Effect.runPromise(source.connectionsOf('acme'));

    expect(listed.map(({ serving }) => serving.renders)).toEqual(['cards']);
  });
});
