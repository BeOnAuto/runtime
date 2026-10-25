import { custodianRefusal } from '@on.auto/secrets/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import type { ConsentClient, ConsentServed } from '../consent/consent-client.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import {
  clockAt,
  connectedByConsent,
  connectedThroughAuto,
  consentClientAt,
  consentClientThrough,
  gatedRequests,
  memoryRegistrations,
  rowOf,
  sealedTokens,
  servedAt,
  servedOf,
  servedTokensOf,
  type ConsentConnected,
  type GatedRequests,
  type ManualClock,
  type SealedTokens,
} from '../testing/index.ts';
import { servedForConsent, servedThroughAuto } from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';
import { renewalWords } from './renewal-words.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const renewalTime = 3_540_000;

const afterTheClaim = renewalTime + 45_000;

interface Sealed {
  readonly connected: ConsentConnected;
  readonly clock: ManualClock;
  readonly row: SealedTokens;
  readonly served: ConsentServed;
}

async function sealedFor(connected: ConsentConnected, clock: ManualClock): Promise<Sealed> {
  const row = await sealedTokens(connected.tokens, clock.now);
  const served = await Effect.runPromise(servedAt(connected.fake, connected.client, row));
  return { connected, clock, row, served };
}

function unwrittenBy({ row }: Sealed): Error {
  return new Error(`The custodian of the key ${row.custodian.kid} refused to wrap a data key: ${custodianRefusal}`);
}

interface Refused {
  readonly failed: unknown;
  readonly renewed: string;
}

async function renewedWhileTheStoreRefuses(
  { clock, row, served }: Sealed,
  consent: ConsentClient,
  gate: GatedRequests,
): Promise<Refused & { readonly source: ReturnType<typeof servedTokensOf>['source'] }> {
  const { source } = servedTokensOf(served, clock.now, consent);
  clock.setTo(renewalTime);
  const renewing = source.token().catch((error: unknown) => error);
  await until(() => gate.holding() === 1);
  row.custodian.refuse();
  gate.release();
  const failed = await renewing;
  const [renewed = ''] = gate.answered();
  return { failed, renewed, source };
}

function claimedAfterAnotherKept(sealed: Sealed, other: ConsentConnected) {
  const anotherKeptFirst = Effect.orDie(sealed.row.replace(1, other.tokens));
  const claims = { made: 0 };
  const row: SealedTokens = {
    ...sealed.row,
    claim: (version, lastingMs) =>
      Effect.suspend(() => {
        claims.made += 1;
        const claimed = sealed.row.claim(version, lastingMs);
        return claims.made === 2 ? Effect.andThen(anotherKeptFirst, claimed) : claimed;
      }),
  };
  return { row, claimsMade: () => claims.made };
}

function revocationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/revoke').length;
}

describe('renewed tokens the secret store cannot keep now', () => {
  it('are kept in memory and revoked nowhere, the call failing in the words of the store, and are kept under the next claim without asking the server again', async () => {
    const fake = await servedForConsent();
    closing.push(fake.close);
    const sealed = await sealedFor(await connectedByConsent(fake), clockAt(0));
    const gate = gatedRequests();

    const { failed, renewed, source } = await renewedWhileTheStoreRefuses(
      sealed,
      consentClientAt(fake, { fetch: gate.fetch }),
      gate,
    );
    const whileClaimed = await source.token();
    sealed.row.custodian.answer();
    sealed.clock.setTo(afterTheClaim);
    const keptLater = await source.token();

    expect(failed).toEqual(unwrittenBy(sealed));
    expect(renewed).not.toBe(sealed.connected.kept.access_token);
    expect(await admitted(fake, renewed)).toBe(true);
    expect(revocationsAt(fake)).toBe(0);
    expect(whileClaimed).toBe(sealed.connected.kept.access_token);
    expect(keptLater).toBe(renewed);
    expect(sealed.row.version()).toBe(2);
    expect(sealed.row.claims()).toEqual([45_000, 45_000]);
    expect(sealed.row.ends()).toEqual([]);
    expect(fake.tokenRequests()).toBe(2);
  });
});

describe('renewed tokens the secret store cannot keep now, through Auto’s consent service', () => {
  it('are kept in memory alike, and the service is asked to revoke nothing', async () => {
    const serving = await servedThroughAuto();
    closing.push(serving.close);
    const sealed = await sealedFor(await connectedThroughAuto(serving), serving.clock);
    const gate = gatedRequests('/tokens/refresh');

    const { failed, source } = await renewedWhileTheStoreRefuses(
      sealed,
      consentClientThrough(serving, { fetch: gate.fetch }),
      gate,
    );
    sealed.row.custodian.answer();
    serving.clock.setTo(afterTheClaim);
    const keptLater = await source.token();

    expect(failed).toEqual(unwrittenBy(sealed));
    expect(keptLater).not.toBe(sealed.connected.kept.access_token);
    expect(await admitted(serving.fake, keptLater)).toBe(true);
    expect(sealed.row.version()).toBe(2);
    expect(serving.service.calls().map(({ path }) => path)).toEqual([
      '/clients',
      '/consents',
      expect.stringMatching(/^\/consents\/[\w-]+\/redeem$/u),
      expect.stringMatching(/^\/handoffs\/[\w-]+$/u),
      '/tokens/refresh',
    ]);
  });
});

describe('renewed tokens the secret store could not keep, before their next claim', () => {
  it('are left where another process keeps tokens of its own first, whose tokens are served instead', async () => {
    const fake = await servedForConsent();
    closing.push(fake.close);
    const sealed = await sealedFor(await connectedByConsent(fake), clockAt(0));
    const other = await connectedByConsent(fake);
    const { row, claimsMade } = claimedAfterAnotherKept(sealed, other);
    const served = await Effect.runPromise(servedAt(fake, sealed.connected.client, row));
    const gate = gatedRequests();

    const { source } = await renewedWhileTheStoreRefuses(
      { ...sealed, row, served },
      consentClientAt(fake, { fetch: gate.fetch }),
      gate,
    );
    sealed.row.custodian.answer();
    sealed.clock.setTo(afterTheClaim);
    const servedLater = await source.token();

    expect(servedLater).toBe(other.kept.access_token);
    expect(sealed.row.version()).toBe(2);
    expect(claimsMade()).toBe(2);
    expect(fake.tokenRequests()).toBe(3);
  });
});

describe('a renewal whose row the secret store cannot read now', () => {
  it('fails the call in the words of the store, breaks nothing and asks the server nothing', async () => {
    const fake = await servedForConsent();
    closing.push(fake.close);
    const sealed = await sealedFor(await connectedByConsent(fake), clockAt(0));
    const { source } = servedTokensOf(sealed.served, sealed.clock.now, consentClientAt(fake));

    sealed.row.custodian.refuse();
    sealed.clock.setTo(renewalTime);
    const failed = await source.token().catch((error: unknown) => error);

    expect(failed).toEqual(
      new Error(
        `The custodian of the key ${sealed.row.custodian.kid} refused to unwrap a data key: ${custodianRefusal}`,
      ),
    );
    expect([sealed.row.version(), sealed.row.claims(), sealed.row.ends(), fake.tokenRequests()]).toEqual([
      1,
      [],
      [],
      1,
    ]);
  });
});

describe('a renewal whose client registration the secret store cannot read now', () => {
  it('fails the call in the words of the store and breaks nothing, and renews once the store reads it again', async () => {
    const fake = await servedForConsent({ dynamicRegistration: true });
    closing.push(fake.close);
    const registrations = memoryRegistrations();
    const dynamic = { registrations, registeredClients: [] };
    const connected = await connectedByConsent(fake, { clients: ['dynamic'] }, dynamic);
    const clock = clockAt(0);
    const row = rowOf(connected, clock.now);
    const { source } = servedTokensOf(
      servedOf(connected, row, { clients: ['dynamic'] }),
      clock.now,
      consentClientAt(fake, dynamic),
    );

    registrations.custodian.refuse();
    clock.setTo(renewalTime);
    const failed = await source.token().catch((error: unknown) => error);
    registrations.custodian.answer();
    const renewed = await source.token();

    expect(failed).toEqual(
      new Error(
        renewalWords.registrationUnreadable(
          'files',
          `The custodian of the key ${registrations.custodian.kid} refused to unwrap a data key: ${custodianRefusal}`,
        ),
      ),
    );
    expect(row.ends()).toEqual([]);
    expect(renewed).not.toBe(connected.kept.access_token);
    expect(row.version()).toBe(2);
  });
});
