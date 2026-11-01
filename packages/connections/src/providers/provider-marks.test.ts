import type { ProviderList } from '@on.auto/providers';
import { fixtureProviders, ledgers, metrics, providersOf, regions, tracker } from '@on.auto/providers/testing';
import { readToolServerSettings, type ConnectionServerSettings, type ConnectionUnready } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added, notes } from '../testing/additions.ts';
import { ada, developerTokenSet, harness, harnessPages, operationNamed, type Harness } from '../testing/harness.ts';
import { makeProviderResolver } from './provider-resolver.ts';

const marking = providersOf(ledgers, metrics, regions, { ...tracker, marks: { reads: ['search_issues'] } });

async function settingsOf(
  h: Harness,
  id: string,
  providers: ProviderList,
): Promise<ConnectionServerSettings | ConnectionUnready> {
  const source = makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    modelProviders: ['openai'],
    providers,
    providerValues: developerTokenSet,
    pages: harnessPages,
  });
  const listed = await Effect.runPromise(source.connectionsOf('acme'));
  const { state } = Option.getOrThrow(Option.fromNullishOr(listed.find((each) => each.id === id)));
  return state.status === 'connected'
    ? Effect.runPromise(
        Effect.match(state.server, {
          onSuccess: ({ settings }): ConnectionServerSettings | ConnectionUnready => settings,
          onFailure: (unready) => unready,
        }),
      )
    : state.unready;
}

function marksInTheSettings(providers: ProviderList) {
  const servers = { issues: { provider: 'tracker', placeholders: { site: 'acme' }, credential: { kind: 'none' } } };
  const read = readToolServerSettings(
    { TOOL_SERVERS: JSON.stringify({ ...servers, issues: { ...servers.issues, org: 'acme' } }) },
    { modelProviders: ['openai'], providers: makeProviderResolver(providers) },
  );
  return Effect.runSync(read).servers.map(({ marks }) => marks);
}

describe('the marks of a provider, named in the settings', () => {
  it('are the marks of the tools its entry gives, and none where it gives none', () => {
    expect([marksInTheSettings(marking), marksInTheSettings(fixtureProviders)]).toEqual([
      [{ reads: ['search_issues'], acts: [] }],
      [{ reads: [], acts: [] }],
    ]);
  });
});

describe('the marks of a connection added by a provider', () => {
  it('are those the entry of its provider gives when it is served, and none for a connection given by hand', async () => {
    const h = harness();
    const tracked = await added(h, {
      provider: 'tracker',
      placeholders: { site: 'acme' },
      credential: { kind: 'none' },
    });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: tracked.id, token: tracked.token });
    const byHand = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: byHand.id, token: byHand.token });

    expect([
      await settingsOf(h, tracked.id, fixtureProviders),
      await settingsOf(h, tracked.id, marking),
      await settingsOf(h, byHand.id, marking),
    ]).toMatchObject([
      { provider: 'tracker', marks: { reads: [], acts: [] } },
      { provider: 'tracker', marks: { reads: ['search_issues'], acts: [] } },
      { provider: null, marks: { reads: [], acts: [] } },
    ]);
  });
});
