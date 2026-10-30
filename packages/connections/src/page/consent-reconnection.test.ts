import type { Outcome } from '@on.auto/operations';
import { admitted, consentedAt, hostOf, registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, reconnected, type Added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, filesWay, finishing, starting } from '../testing/consents.ts';
import { harnessConsentOf } from '../testing/harness-services.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const tokensIn = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String })),
);

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const StartedSchema = Schema.Struct({ output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String }) }) });

function consentedThrough(started: Outcome) {
  return consentedAt(Schema.decodeUnknownSync(StartedSchema)(started).output.authorize.url);
}

function revocationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/revoke').length;
}

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake({ dynamicRegistration: true });
  closing.push(fake.close);
  return fake;
}

function rowsOf(h: Harness): readonly string[] {
  return [...h.secrets.values().values()].filter((value) => value.includes('access_token'));
}

async function connectedOnce(h: Harness): Promise<{ readonly link: Added; readonly tokens: string }> {
  const link = await added(h, { provider: 'files' });
  await finishing(h, link, await consentedOf(h, link));
  const [tokens = ''] = rowsOf(h);
  return { link, tokens };
}

describe('reconnecting a connection connected by consent with the client it was made with', () => {
  it('forgets the tokens it held without revoking them, since the authorization server may end the new grant with them', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake, { consenting: { registeredClients: [registeredAt(fake.origin)] } });
    const { link: first, tokens: before } = await connectedOnce(h);

    const link = await reconnected(h, first.id, fiveMinutesLater);
    const finished = await finishing(h, link, await consentedOf(h, link, fiveMinutesLater), fiveMinutesLater);

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', connected_at: fiveMinutesLater, credential: { client_id: 'auto-runtime' } },
    });
    expect(revocationsAt(fake)).toBe(0);
    expect(await admitted(fake, tokensIn(before).access_token)).toBe(true);
    expect(rowsOf(h)).toHaveLength(1);
    expect(rowsOf(h)).not.toContain(before);
  });
});

describe('reconnecting a connection connected by consent with another client', () => {
  it('revokes the tokens it held with the client they were given to, once the new ones are kept', async () => {
    const fake = await served();
    const way = { ...filesWay, clients: ['registered', 'dynamic'] };
    const h = consentHarnessAt(fake, { way, consenting: { registeredClients: [] } });
    const { link: first, tokens: before } = await connectedOnce(h);
    const withARegisteredClient = h.operationsWith({
      consent: harnessConsentOf(h.ledger.service, h.secrets, { registeredClients: [registeredAt(fake.origin)] }),
    });

    const { id, token } = await reconnected(h, first.id, fiveMinutesLater);
    const started = await h.call(operationNamed(withARegisteredClient, 'start'), ada, { id, token }, fiveMinutesLater);
    const { code, state, iss } = await consentedThrough(started);
    const finished = await h.call(
      operationNamed(withARegisteredClient, 'finish'),
      ada,
      { id, token, code, state, iss },
      fiveMinutesLater,
    );

    expect(finished).toMatchObject({ output: { status: 'connected', credential: { client_id: 'auto-runtime' } } });
    expect(revocationsAt(fake)).toBe(1);
    expect(await admitted(fake, tokensIn(before).access_token)).toBe(false);
    expect(rowsOf(h)).toHaveLength(1);
  });
});

const registeringOnceInAWhile = {
  dynamicRegistration: true,
  takesPublicClientsAlone: true,
  registrationSecretSeconds: -60,
  registrationsBeforeTheLimit: 1,
  registrationRetryAfter: '600',
};

const dynamicWay = { ...filesWay, clients: ['dynamic'] };

function registrationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/register').length;
}

function unansweringItsMetadata(retryAfter: string) {
  return (...[address, init]: readonly [unknown, unknown?]): Promise<Response> =>
    new URL(String(address)).pathname === '/.well-known/oauth-authorization-server'
      ? Promise.resolve(new Response('busy', { status: 503, headers: { 'retry-after': retryAfter } }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

describe('a start of a connection connected by consent, at a server that registers a client once in a while', () => {
  it('takes the client the runtime registered for the first consent, so the server is asked to register once', async () => {
    const fake = await consentFake(registeringOnceInAWhile);
    closing.push(fake.close);
    const h = consentHarnessAt(fake, { way: dynamicWay, consenting: { registeredClients: [] } });
    const { link: first } = await connectedOnce(h);

    const link = await reconnected(h, first.id, fiveMinutesLater);
    const started = await starting(h, link, fiveMinutesLater);
    const finished = await finishing(h, link, await consentedThrough(started), fiveMinutesLater);

    expect(started).toMatchObject({ status: 'succeeded', output: { client_source: 'dynamic' } });
    expect(finished).toMatchObject({
      output: { status: 'connected', credential: { client_id: 'registered-1', client_source: 'dynamic' } },
    });
    expect(registrationsAt(fake)).toBe(1);
  });

  it('is refused in words that say the connection stays connected and name the host, the step, the status and the wait', async () => {
    const fake = await consentFake(registeringOnceInAWhile);
    closing.push(fake.close);
    const h = consentHarnessAt(fake, { way: dynamicWay, consenting: { registeredClients: [] } });
    const { link: first } = await connectedOnce(h);
    const unanswering = h.operationsWith({
      consent: harnessConsentOf(h.ledger.service, h.secrets, { fetch: unansweringItsMetadata('120') }),
    });

    const { id, token } = await reconnected(h, first.id, fiveMinutesLater);
    const refused = await h.call(operationNamed(unanswering, 'start'), ada, { id, token }, fiveMinutesLater);
    const read = await h.call(operationNamed(h.operations, 'read_link'), ada, { id, token }, fiveMinutesLater);

    expect(refused).toMatchObject({
      reason: 'unavailable',
      detail: `The consent of the connection files cannot go on: ${hostOf(fake)} answered the read of its authorization server metadata with HTTP 503; try again in 2 minutes; the connection files stays connected as it was`,
    });
    expect(read).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
  });
});

describe('a start of a connection connected by consent, refused for another reason', () => {
  it('is refused in its own words, saying the connection stays connected too', async () => {
    const fake = await consentFake(registeringOnceInAWhile);
    closing.push(fake.close);
    const h = consentHarnessAt(fake, { way: dynamicWay, consenting: { registeredClients: [] } });
    const { link: first } = await connectedOnce(h);
    const elsewhere = h.operationsWith({ policy: connectionPolicyOf({ allowed_hosts: ['crm.example.com'] }) });

    const { id, token } = await reconnected(h, first.id, fiveMinutesLater);
    const refused = await h.call(operationNamed(elsewhere, 'start'), ada, { id, token }, fiveMinutesLater);

    expect(refused).toMatchObject({
      reason: 'forbidden',
      detail:
        'A connection may not reach the host 127.0.0.1 on this runtime, which allows crm.example.com; the connection files stays connected as it was',
    });
  });
});

describe('a finish of a connection connected by consent, given what its start does not answer', () => {
  it('is refused at the handle, saying the connection stays connected', async () => {
    const fake = await consentFake(registeringOnceInAWhile);
    closing.push(fake.close);
    const h = consentHarnessAt(fake, { way: dynamicWay, consenting: { registeredClients: [] } });
    const { link: first } = await connectedOnce(h);

    const link = await reconnected(h, first.id, fiveMinutesLater);
    const { state } = await consentedThrough(await starting(h, link, fiveMinutesLater));
    const returned = { id: link.id, token: link.token, state, handle: 'a-handle' };
    const refused = await h.call(operationNamed(h.operations, 'finish'), ada, returned, fiveMinutesLater);

    expect(refused).toMatchObject({
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/handle',
          detail:
            "Expected code: the consent of the connection files began with a client of this runtime's, which answers a code, not a handle; the connection files stays connected as it was",
        },
      ],
    });
  });
});
