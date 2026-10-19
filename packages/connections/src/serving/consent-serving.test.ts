import { providerListOf } from '@on.auto/providers/testing';
import type { OrgConnection } from '@on.auto/tool-servers';
import type { FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, finishing } from '../testing/consents.ts';
import { makeConnectionSource } from './connection-source.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake();
  closing.push(fake.close);
  return fake;
}

function preparedOf(connection: OrgConnection | undefined) {
  return connection?.state.status === 'connected'
    ? connection.state.server
    : Effect.die(new Error('Expected a connected connection'));
}

describe('a connection connected by consent', () => {
  it('is served to no call yet, in words that say why', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    await finishing(h, link, await consentedOf(h, link));
    const source = makeConnectionSource({
      registry: h.ledger.service,
      secrets: h.secrets,
      policy: connectionPolicyOf({}),
      variables: new Map(),
      modelProviders: [],
      providers: providerListOf(),
      providerValues: new Map(),
    });

    const [listed] = await Effect.runPromise(source.connectionsOf('acme'));
    const refused = await Effect.runPromise(Effect.flip(preparedOf(listed)));

    expect(refused).toEqual({
      because: 'connection_not_allowed',
      detail:
        'This runtime calls no tool through the connection files, which was connected by signing in to its provider',
    });
  });
});
