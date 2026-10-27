import type { Outcome, Succeeded } from '@on.auto/operations';
import { admitted, consentedAt, registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnected, type Added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, filesWay, finishing } from '../testing/consents.ts';
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

function consentedThrough(started: Outcome<Succeeded>) {
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
