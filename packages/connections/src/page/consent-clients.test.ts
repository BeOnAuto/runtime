import { providerListOf } from '@on.auto/providers/testing';
import type { ClientRegistration, FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { clientRegistrationsStream } from '../registrations/client-registrations.ts';
import { added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, filesApiAt, finishing, startedAt } from '../testing/consents.ts';
import { ada, operationNamed } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

const dynamicWay = { clients: ['dynamic'] };

describe('the client a connection is connected with', () => {
  it('is registered dynamically once at its issuer, recorded in a stream of the runtime, and used again by a later connection', async () => {
    const fake = await served({ dynamicRegistration: true });
    const h = consentHarnessAt(fake, { way: dynamicWay });
    const first = await added(h, { provider: 'files' });
    const second = await added(h, { provider: 'files', name: 'files-again' });

    const connected = await finishing(h, first, await consentedOf(h, first));
    await startedAt(h, second);

    expect(connected).toMatchObject({
      output: { status: 'connected', credential: { client_id: 'registered-1', client_source: 'dynamic' } },
    });
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
    expect(h.ledger.streamNames()).toContain(clientRegistrationsStream);
  });

  it('is gone where the registration it was made with is no longer kept, and the finish says so', async () => {
    const fake = await served({ dynamicRegistration: true });
    const h = consentHarnessAt(fake, { way: dynamicWay });
    const link = await added(h, { provider: 'files' });
    const consented = await consentedOf(h, link);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    expect(await finishing(h, link, consented)).toMatchObject({
      reason: 'conflict',
      detail:
        'The client the connection files was made with is no longer registered, so the person who added it removes it and adds it again',
    });
  });
});

describe('a connection of an HTTP API whose way gives its endpoints', () => {
  it('is connected through a server that publishes no metadata, with no scope where none was asked or granted', async () => {
    const fake = await served({ publishesMetadata: false });
    const h = consentHarnessAt(fake, { providers: providerListOf(filesApiAt(fake)) });
    const link = await added(h, { provider: 'files-api' });

    const connected = await finishing(h, link, await consentedOf(h, link));

    expect(connected).toMatchObject({ output: { status: 'connected', type: 'openapi' } });
    expect(connected).not.toHaveProperty('output.credential.scope');
  });
});

describe('a connection connected by consent', () => {
  it('forgets the verifier of an open start when it is removed while pending', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    await startedAt(h, link);

    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(h.secrets.values().size).toBe(0);
  });
});
