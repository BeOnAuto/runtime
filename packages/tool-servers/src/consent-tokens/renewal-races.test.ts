import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import {
  connectedByConsent,
  consentClientAt,
  cuttingTimeouts,
  gatedRequests,
  goneWords,
  rowOf,
  servedOf,
  servedTokensOf,
  clockAt,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const renewalTime = 3_540_000;

async function twoProcessesOverOneRow() {
  const fake = await servedForConsent();
  closing.push(fake.close);
  const connected = await connectedByConsent(fake);
  const clock = clockAt(0);
  const row = rowOf(connected, clock.now);
  const served = servedOf(connected, row);
  return { fake, clock, row, served };
}

function heardAt(fake: FakeMcpServer, path: string): number {
  return fake.heard().filter((heard) => heard.path === path).length;
}

async function cutOffAt(requestMs: number) {
  const { fake, clock, row, served } = await twoProcessesOverOneRow();
  const gate = gatedRequests();
  const timeouts = cuttingTimeouts();
  const { requestTimeout } = timeouts;
  const { source } = servedTokensOf(
    served,
    clock.now,
    consentClientAt(fake, { fetch: gate.fetch, requestMs, requestTimeout }),
  );
  clock.setTo(renewalTime);
  const renewing = source.token().catch((error: unknown) => error);
  await until(() => gate.holding() === 1);
  clock.advance(requestMs);
  timeouts.cut();
  gate.release();
  const failed = await renewing;
  const { claimedUntil } = Effect.runSync(Effect.orDie(row.read));
  return {
    cuts: timeouts.cuts(),
    claims: row.claims(),
    failed,
    claimedFor: Date.parse(String(claimedUntil)) - clock.now(),
  };
}

describe('a renewal two processes reach at once', () => {
  it('is made by the first, and read rather than made again by the second', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const first = servedTokensOf(served, clock.now, consentClientAt(fake));
    const second = servedTokensOf(served, clock.now, consentClientAt(fake));

    clock.setTo(renewalTime);
    const renewed = await first.source.token();
    const read = await second.source.token();

    expect(read).toBe(renewed);
    expect(row.version()).toBe(2);
    expect(fake.tokenRequests()).toBe(2);
  });
});

describe('a renewal another process holds a claim for', () => {
  it('is waited for by the second while the first holds its claim, which then reads what the first renewed', async () => {
    const { fake, clock, served } = await twoProcessesOverOneRow();
    const gate = gatedRequests();
    const first = servedTokensOf(served, clock.now, consentClientAt(fake, { fetch: gate.fetch }));
    const second = servedTokensOf(served, clock.now, consentClientAt(fake));

    clock.setTo(renewalTime);
    const renewing = first.source.token();
    await until(() => gate.holding() === 1);
    const waiting = second.source.token();
    await until(() => second.timer.waits().length === 1);
    gate.release();
    const renewed = await renewing;
    second.timer.fire();

    expect(await waiting).toBe(renewed);
    expect(second.timer.waits()).toEqual([30_000]);
    expect(fake.tokenRequests()).toBe(2);
  });

  it('is given up by the second as the bound of its call ends, while the first still holds its claim', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const gate = gatedRequests();
    const first = servedTokensOf(served, clock.now, consentClientAt(fake, { fetch: gate.fetch, requestMs: 60_000 }));
    const second = servedTokensOf(served, clock.now, consentClientAt(fake));

    clock.setTo(renewalTime);
    const renewing = first.source.token();
    await until(() => gate.holding() === 1);
    const waiting = second.source.token();
    await until(() => second.timer.waits().length === 1);
    clock.advance(30_000);
    second.timer.fire();
    const givenUp = await waiting.catch((error: unknown) => error);
    gate.release();
    await renewing;

    expect(givenUp).toEqual(
      new Error(
        'The tokens of the connection files are being renewed by another process of the runtime, which did not finish within 30000 ms; the next call tries again',
      ),
    );
    expect(row.claims()).toEqual([75_000]);
  });
});

describe('a renewal that loses its row to another process before it claims it', () => {
  it('reads the row again and takes what the other renewed', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const gate = gatedRequests('/.well-known/oauth-authorization-server');
    const late = servedTokensOf(served, clock.now, consentClientAt(fake, { fetch: gate.fetch }));
    const early = servedTokensOf(served, clock.now, consentClientAt(fake));

    clock.setTo(renewalTime);
    const reading = late.source.token();
    await until(() => gate.holding() === 1);
    const renewed = await early.source.token();
    gate.release();

    expect(await reading).toBe(renewed);
    expect(row.claims()).toEqual([45_000, 45_000]);
    expect(fake.tokenRequests()).toBe(2);
  });
});

describe('a renewal that finds tokens another process renewed long ago', () => {
  it('renews them too where they are past their own renewal time', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const first = servedTokensOf(served, clock.now, consentClientAt(fake));
    const second = servedTokensOf(served, clock.now, consentClientAt(fake));

    clock.setTo(renewalTime);
    const renewedByTheFirst = await first.source.token();
    clock.setTo(2 * renewalTime + 120_000);
    const renewedByTheSecond = await second.source.token();

    expect(renewedByTheSecond).not.toBe(renewedByTheFirst);
    expect(row.version()).toBe(3);
    expect(fake.tokenRequests()).toBe(3);
  });
});

describe('the lease a renewal claims its row for', () => {
  it('is the bound of the request it sends and fifteen seconds more, forty-five seconds by default', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const longer = await twoProcessesOverOneRow();
    const { source } = servedTokensOf(served, clock.now, consentClientAt(fake));
    const bounded = servedTokensOf(
      longer.served,
      longer.clock.now,
      consentClientAt(longer.fake, { requestMs: 45_000 }),
    );

    clock.setTo(renewalTime);
    longer.clock.setTo(renewalTime);
    await source.token();
    await bounded.source.token();

    expect([row.claims(), longer.row.claims()]).toEqual([[45_000], [60_000]]);
  });

  it('outlasts the refresh, which is cut off at the bound of its request before the claim ends', async () => {
    const thirty = await cutOffAt(30_000);
    const fortyFive = await cutOffAt(45_000);

    expect([thirty, fortyFive]).toMatchObject([
      { cuts: [30_000, 30_000, 30_000, 30_000], claims: [45_000], failed: { name: 'AbortError' } },
      { cuts: [45_000, 45_000, 45_000, 45_000], claims: [60_000], failed: { name: 'AbortError' } },
    ]);
    expect([thirty.claimedFor, fortyFive.claimedFor]).toEqual([15_000, 15_000]);
  });
});

describe('a renewal whose row moved before it replaces it', () => {
  it('takes the tokens the row holds, and revokes nothing', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const other = await connectedByConsent(fake);
    const gate = gatedRequests();
    const { source } = servedTokensOf(served, clock.now, consentClientAt(fake, { fetch: gate.fetch }));

    clock.setTo(renewalTime);
    const renewing = source.token();
    await until(() => gate.holding() === 1);
    Effect.runSync(row.replace(1, other.tokens));
    gate.release();
    const taken = await renewing;
    const [got = ''] = gate.answered();

    expect(taken).toBe(other.kept.access_token);
    expect(heardAt(fake, '/revoke')).toBe(0);
    expect([await admitted(fake, taken), await admitted(fake, got)]).toEqual([true, true]);
  });
});

describe('a renewal whose row is gone before it replaces it', () => {
  it('revokes the tokens it got, and fails in the words its row is read with', async () => {
    const { fake, clock, row, served } = await twoProcessesOverOneRow();
    const gate = gatedRequests();
    const { source } = servedTokensOf(served, clock.now, consentClientAt(fake, { fetch: gate.fetch }));

    clock.setTo(renewalTime);
    const renewing = source.token().catch((error: unknown) => error);
    await until(() => gate.holding() === 1);
    row.forget();
    gate.release();
    const failed = await renewing;
    const [got = ''] = gate.answered();

    expect(failed).toEqual(new Error(goneWords));
    expect(await admitted(fake, got)).toBe(false);
    expect(heardAt(fake, '/revoke')).toBe(1);
  });
});
