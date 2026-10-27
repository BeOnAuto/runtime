import { statement } from '@on.auto/ledger';
import { STANDARD_OFFLINE_MILLISECONDS } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import type { MeterDatabase } from './database.ts';
import { licenseClientFixture } from './license-client-fixture.ts';

export function licenseClientBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('activation and refresh', () => {
    activationBehaviour(open);
  });
  describe('durable completion recovery', () => {
    recoveryBehaviour(open);
  });
  describe('confirmed refusal and temporary unavailability', () => {
    refusalBehaviour(open);
  });
  describe('replica admission and completion refusals', () => {
    concurrentBehaviour(open);
  });
}

function activationBehaviour(open: () => Promise<MeterDatabase>): void {
  it('repairs time, activates, refreshes with the installed key and preserves the binding across restart', async () => {
    const f = await licenseClientFixture(open);
    expect((await f.client.head()).state).toBe('unlicensed');
    await expect(f.client.current()).rejects.toThrow('license_clock_untrusted');
    await expect(f.client.refresh()).rejects.toThrow('license_required');
    expect(await f.client.resume()).toBeUndefined();
    const activated = await f.client.activate('activation-secret');
    expect(activated.license.generation).toBe(1);
    f.pass(86_400_000);
    const replica = await f.restart();
    const refreshed = await replica.refresh();
    expect(refreshed.license.generation).toBe(2);
    expect(refreshed.license.offlineDeadline).toBe(activated.license.offlineDeadline + 86_400_000);
    expect((await f.client.current()).license).toEqual(refreshed.license);
    expect(f.authority.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/licenses/time',
      '/licenses/activation-challenge',
      '/licenses/complete',
      '/licenses/time',
      '/licenses/refresh-challenge',
      '/licenses/complete',
    ]);
    expect(await f.database.connection.read(statement`SELECT * FROM meter_pending_license`)).toEqual([]);
  });

  it('verifies completion at receipt time when issuing the license crosses a second boundary', async () => {
    const f = await licenseClientFixture(open);
    f.authority.state.completeDelay = 1500;
    expect((await f.client.activate('activation-secret')).license.issuedAt).toBe(6000);
    expect((await f.client.current()).license.generation).toBe(1);
  });
}

function recoveryBehaviour(open: () => Promise<MeterDatabase>): void {
  it('replaces an expired historical completion with a fresh proven exchange after a long outage', async () => {
    const f = await licenseClientFixture(open);
    f.authority.state.loseCompletion = true;
    await expect(f.client.activate('activation-secret')).rejects.toThrow('license_service_unavailable');
    f.pass(STANDARD_OFFLINE_MILLISECONDS + 1000);
    const replica = await f.restart();
    const result = await replica.resume();
    expect(result?.license.generation).toBe(2);
    expect(result?.license.issuedAt).toBe(f.authority.state.now);
    expect(f.authority.requests.filter((request) => request.url.endsWith('/activation-challenge'))).toHaveLength(1);
    expect(f.authority.requests.filter((request) => request.url.endsWith('/refresh-challenge'))).toHaveLength(1);
  });

  it('recovers a lost activation reply after restart without storing or resending the activation secret', async () => {
    const f = await licenseClientFixture(open);
    f.authority.state.loseCompletion = true;
    await expect(f.client.activate('activation-secret')).rejects.toThrow('license_service_unavailable');
    const rows = await f.database.connection.read(statement`SELECT challenge_payload FROM meter_pending_license`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('activation-secret');
    f.pass(400_000);
    const replica = await f.restart();
    const recovered = await replica.resume();
    expect(recovered?.license.generation).toBe(1);
    expect(recovered?.license.offlineDeadline).toBe(5000 + STANDARD_OFFLINE_MILLISECONDS);
    expect(f.authority.requests.filter((request) => request.url.endsWith('/activation-challenge'))).toHaveLength(1);
    expect(await replica.resume()).toBeUndefined();
  });

  it('uses refresh to resume a pending activation while preserving its original lease deadline', async () => {
    const f = await licenseClientFixture(open);
    f.authority.state.loseCompletion = true;
    await expect(f.client.activate('activation-secret')).rejects.toThrow('license_service_unavailable');
    f.pass(1000);
    const result = await f.client.refresh();
    expect(result.license.offlineDeadline).toBe(5000 + STANDARD_OFFLINE_MILLISECONDS);
    expect(result.license.generation).toBe(1);
  });
}

function refusalBehaviour(open: () => Promise<MeterDatabase>): void {
  it('stops new work on an authenticated refresh refusal, and a later authorized exchange restores it', async () => {
    const f = await licenseClientFixture(open);
    await f.client.activate('activation-secret');
    f.authority.state.challengeStatus = 401;
    await expect(f.client.refresh()).rejects.toMatchObject({ status: 401 });
    expect((await f.client.head()).state).toBe('refused');
    await expect(f.client.current()).rejects.toThrow('license_not_active');
    f.authority.state.challengeStatus = 0;
    expect((await f.client.refresh()).license.generation).toBe(2);
  });

  it('retains a valid existing lease after an invalid activation key or transient refresh failure', async () => {
    const f = await licenseClientFixture(open);
    const original = await f.client.activate('activation-secret');
    await expect(f.client.activate('incorrect-key')).rejects.toMatchObject({ status: 401 });
    f.authority.state.completeStatus = 503;
    await expect(f.client.refresh()).rejects.toMatchObject({ status: 503 });
    expect((await f.client.current()).license).toEqual(original.license);
    f.authority.state.completeStatus = 0;
    expect((await f.client.resume())?.license.generation).toBe(2);
    f.pass(STANDARD_OFFLINE_MILLISECONDS);
    await expect(f.client.current()).rejects.toThrow('exp');
  });
}

function concurrentBehaviour(open: () => Promise<MeterDatabase>): void {
  it('converges racing replicas on the current licensed binding without a false refusal', async () => {
    const f = await licenseClientFixture(open);
    const replica = await f.restart();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => [
        f.client.activate('activation-secret'),
        replica.activate('activation-secret'),
      ]).flat(),
    );
    expect(results.some((result: Readonly<PromiseSettledResult<unknown>>) => result.status === 'fulfilled')).toBe(true);
    const head = await f.client.head();
    expect(head.state).toBe('active');
    expect(head.generation).toBeGreaterThanOrEqual(1);
    expect(head.generation).toBeLessThanOrEqual(20);
    expect(await f.client.current()).toEqual(await replica.current());
    expect(await f.database.connection.read(statement`SELECT serial FROM meter_license_history`)).toHaveLength(
      head.revision,
    );
  });

  it.each([401, 403])('fences a refused completion (%s) and clears its pending challenge', async (status) => {
    const f = await licenseClientFixture(open);
    await f.client.activate('activation-secret');
    f.authority.state.completeStatus = status;
    await expect(f.client.refresh()).rejects.toMatchObject({ status });
    expect((await f.client.head()).state).toBe('refused');
    expect(await f.client.resume()).toBeUndefined();
    f.authority.state.completeStatus = 0;
    expect((await f.client.refresh()).license.generation).toBe(2);
  });

  it.each([400, 409])('discards an unusable pending challenge (%s) while retaining the valid lease', async (status) => {
    const f = await licenseClientFixture(open);
    const original = await f.client.activate('activation-secret');
    f.authority.state.completeStatus = status;
    await expect(f.client.refresh()).rejects.toMatchObject({ status });
    expect(await f.client.resume()).toBeUndefined();
    expect((await f.client.current()).license).toEqual(original.license);
    f.authority.state.completeStatus = 0;
    expect((await f.client.refresh()).license.generation).toBe(2);
  });
}
