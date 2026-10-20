import { createHash } from 'node:crypto';

import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConsentClient, StartAsked } from '../consent/consent-client.ts';
import {
  autoClientsOf,
  consentClientWith,
  returnAddress,
  servedThroughAuto,
  startAskedAt,
  type FakeConsentService,
  type ThroughAuto,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function throughAuto(): Promise<ThroughAuto> {
  const serving = await servedThroughAuto();
  closing.push(serving.close);
  return serving;
}

function started(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(client.start(asked));
}

function refused(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(Effect.flip(client.start(asked)));
}

function challengeOf(verifier: Redacted.Redacted): string {
  return createHash('sha256').update(Redacted.value(verifier)).digest('base64url');
}

function pathsHeardBy(service: FakeConsentService): readonly string[] {
  return service.calls().map(({ path }) => path);
}

const rule = 'The rules of whoever runs Auto do not allow the host 127.0.0.1';

function refusingEveryHostBut(origin: string) {
  return (url: string): string | undefined => (new URL(url).origin === origin ? undefined : rule);
}

function refusingTheHostOf(origin: string) {
  return (url: string): string | undefined => (new URL(url).origin === origin ? rule : undefined);
}

const loopbackBase = 'http://127.0.0.1:5555/studio/';

interface Asking {
  readonly asked: StartAsked;
  readonly client: ConsentClient;
}

describe('the start of a consent through Auto’s consent service', () => {
  it('asks the service with the issuer, the scope, the parameters, the resource, the loopback base and the challenge of its own verifier', async () => {
    const { fake, service } = await throughAuto();
    const client = consentClientWith({ autoClients: autoClientsOf(service, 'loopback') });
    const asked = { ...startAskedAt(fake, { parameters: { access_type: 'offline' } }), studioBase: loopbackBase };

    const start = await started(client, asked);

    expect(service.calls().at(-1)?.body).toEqual({
      issuer: fake.origin,
      scope: 'files.read',
      parameters: { access_type: 'offline' },
      resource: `${fake.origin}/mcp`,
      return: { kind: 'loopback', base: loopbackBase },
      challenge: challengeOf(start.verifier),
      challenge_method: 'S256',
    });
    expect(pathsHeardBy(service)).toEqual(['/clients', '/consents']);
  });

  it('answers the page and the state the service made, and Auto’s client at the issuer', async () => {
    const { fake, service } = await throughAuto();
    const client = consentClientWith({ autoClients: autoClientsOf(service, 'loopback') });

    const start = await started(client, { ...startAskedAt(fake), studioBase: loopbackBase });
    const page = new URL(start.url);

    expect(start.client).toEqual({ client_id: 'auto-runtime', client_source: 'auto' });
    expect([page.origin, page.searchParams.get('state'), page.searchParams.get('redirect_uri')]).toEqual([
      fake.origin,
      start.state,
      returnAddress,
    ]);
    expect(start.state).not.toBe('state-1');
  });
});

describe('the start of a consent through Auto’s consent service from the hosted Studio', () => {
  it('asks to return to the Studio host, and reaches the service whatever the rules say of its host', async () => {
    const { fake, service } = await throughAuto();
    const client = consentClientWith({ autoClients: autoClientsOf(service, 'hosted') });

    const start = await started(client, { ...startAskedAt(fake), reaches: refusingTheHostOf(service.url) });

    expect(service.calls().at(-1)?.body).toMatchObject({ return: { kind: 'hosted' } });
    expect(start.client.client_source).toBe('auto');
  });

  it('is refused in the rule’s words where the rules refuse the host of the authorization server', async () => {
    const { fake, service } = await throughAuto();
    const client = consentClientWith({ autoClients: autoClientsOf(service) });

    expect(await refused(client, { ...startAskedAt(fake), reaches: refusingEveryHostBut(service.url) })).toEqual({
      refused: 'host',
      rule,
    });
    expect(pathsHeardBy(service)).toEqual(['/clients']);
  });
});

describe('a start through Auto’s consent service refused before anything is sent', () => {
  it('is refused where the link opens a Studio neither hosted nor on this computer', async () => {
    const { fake, service } = await throughAuto();
    const client = consentClientWith({ autoClients: autoClientsOf(service, 'elsewhere') });

    expect(await refused(client, startAskedAt(fake))).toEqual({ refused: 'studio_elsewhere' });
    expect([pathsHeardBy(service), fake.heard()]).toEqual([['/clients'], []]);
  });
});

describe('a start the consent service refuses or does not answer', () => {
  it('is refused as having no client where the service refuses it, and unanswered where it is gone or stalls', async () => {
    const [refusing, gone, stalling] = await Promise.all([throughAuto(), throughAuto(), throughAuto()]);
    const asking = [refusing, gone, stalling].map((serving): Asking => ({
      asked: startAskedAt(serving.fake),
      client: consentClientWith({ autoClients: autoClientsOf(serving.service), requestMs: 200 }),
    }));
    await Effect.runPromise(Effect.all(asking.map(({ client }) => client.hadSources)));
    refusing.service.refuseNext('start');
    await gone.service.close();
    stalling.service.stall();

    const answers = await Promise.all(asking.map(({ client, asked }) => refused(client, asked)));

    expect(answers).toEqual([{ refused: 'no_client' }, { refused: 'unanswered' }, { refused: 'unanswered' }]);
  });
});
