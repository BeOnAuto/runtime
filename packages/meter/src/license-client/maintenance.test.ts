import { describe, expect, it } from 'vitest';

import type { LicenseClient } from '../index.ts';
import { licenseClientFixture } from '../testing/license-client-fixture.ts';

async function retryFailures(
  client: LicenseClient,
  pass: (elapsed: number) => void,
  attempts: number,
): Promise<number> {
  const result = await client.poll();
  expect(result.status).toBe('failed');
  pass(result.retryInMilliseconds);
  return attempts === 1 ? result.retryInMilliseconds : retryFailures(client, pass, attempts - 1);
}

describe('daily license refresh', () => {
  it('does no network work without a license and polls locally before the signed refresh time', async () => {
    const f = await licenseClientFixture();
    expect(await f.client.poll()).toEqual({ status: 'idle', retryInMilliseconds: 60_000 });
    expect(f.authority.requests).toHaveLength(0);
    await f.client.activate('activation-secret');
    f.pass(60_000);
    expect((await f.client.poll()).status).toBe('idle');
    expect(f.authority.requests).toHaveLength(3);
    f.pass(10_000);
    expect(await f.client.poll()).toEqual({ status: 'idle', retryInMilliseconds: 50_000 });
  });

  it('refreshes with deterministic per-installation jitter before the daily deadline', async () => {
    const f = await licenseClientFixture();
    const { license } = await f.client.activate('activation-secret');
    const jitter = Number.parseInt(license.installationKeyDigest.slice(0, 8), 16) % 900_000;
    f.pass(86_400_000 - jitter);
    expect((await f.client.poll()).status).toBe('refreshed');
    expect((await f.client.current()).license.generation).toBe(2);
  });

  it('coalesces concurrent local polls and resumes a pending completion', async () => {
    const f = await licenseClientFixture();
    f.authority.state.loseCompletion = true;
    await expect(f.client.activate('activation-secret')).rejects.toThrow('license_service_unavailable');
    const results = await Promise.all(Array.from({ length: 20 }, () => f.client.poll()));
    expect(results.every((result) => result.status === 'refreshed')).toBe(true);
    expect(f.authority.requests.filter((request) => request.url.endsWith('/complete'))).toHaveLength(2);
    expect((await f.client.current()).license.generation).toBe(1);
  });
});

describe('bounded refresh retries and clock repair', () => {
  it('backs off temporary failures without moving the license cutoff and resets after recovery', async () => {
    const f = await licenseClientFixture();
    const original = await f.client.activate('activation-secret');
    f.pass(86_400_000);
    f.authority.state.completeStatus = 429;
    expect(await f.client.poll()).toEqual({ status: 'failed', retryInMilliseconds: 30_000 });
    expect((await f.client.poll()).status).toBe('idle');
    f.pass(30_000);
    expect(await f.client.poll()).toEqual({ status: 'failed', retryInMilliseconds: 60_000 });
    expect((await f.client.current()).license.offlineDeadline).toBe(original.license.offlineDeadline);
    f.pass(60_000);
    f.authority.state.completeStatus = 0;
    expect((await f.client.poll()).status).toBe('refreshed');
    f.pass(86_400_000);
    f.authority.state.completeStatus = 503;
    expect(await f.client.poll()).toEqual({ status: 'failed', retryInMilliseconds: 30_000 });
  });

  it('repairs a suspect clock and uses fresh authority after process monotonic time regresses', async () => {
    const f = await licenseClientFixture();
    await f.client.activate('activation-secret');
    f.pass(60_000);
    expect((await f.client.poll()).status).toBe('idle');
    f.time.state.wall -= 10_000;
    f.time.state.monotonic = 0;
    expect((await f.client.poll()).status).toBe('refreshed');
    expect((await f.client.current()).license.generation).toBe(2);
  });
});

describe('extended refresh unavailability', () => {
  it('caps repeated failures at one retry per hour and retains the original cutoff', async () => {
    const f = await licenseClientFixture();
    const original = await f.client.activate('activation-secret');
    f.pass(86_400_000);
    f.authority.state.completeStatus = 503;
    expect(await retryFailures(f.client, f.pass, 9)).toBe(3_600_000);
    expect((await f.client.current()).license.offlineDeadline).toBe(original.license.offlineDeadline);
    expect(f.authority.requests.filter((request) => request.url.endsWith('/complete'))).toHaveLength(10);
  });

  it('obtains new authority after expiry without admitting work under the expired license', async () => {
    const f = await licenseClientFixture();
    const original = await f.client.activate('activation-secret');
    f.pass(original.license.offlineDeadline - original.license.issuedAt);
    await expect(f.client.current()).rejects.toThrow('exp');
    expect((await f.client.poll()).status).toBe('refreshed');
    expect((await f.client.current()).license.generation).toBe(2);
  });
});
