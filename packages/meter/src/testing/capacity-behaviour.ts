import { statement } from '@on.auto/ledger';
import { offlineCheckpoint, allocationPayload, type OfflineAllocation } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineCapacity } from '../index.ts';
import { capacityFixture } from './capacity-fixture.ts';
import type { MeterDatabase } from './database.ts';

export function capacityBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('signed capacity installation', () => {
    installationBehaviour(open);
  });
  describe('capacity epochs and evidence', () => {
    historyBehaviour(open);
  });
  describe('atomic capacity persistence', () => {
    persistenceBehaviour(open);
  });
  describe('capacity authorization races', () => {
    authorityBehaviour(open);
  });
  describe('bounded capacity size', () => {
    maximumSourcesBehaviour(open);
  });
}

function installationBehaviour(open: () => Promise<MeterDatabase>): void {
  it('installs exact source quantities once and preserves them after reopening', async () => {
    const f = await capacityFixture(open);
    expect(await f.capacity.snapshot()).toBeUndefined();
    expect(await f.capacity.install(f.token)).toEqual({
      id: f.allocation.id,
      epoch: 1,
      state: 'open',
      status: 'installed',
    });
    const replica = await f.replica();
    expect(await replica.install(f.token)).toMatchObject({ status: 'existing' });
    const snapshot = await replica.snapshot();
    expect(snapshot?.allocation).toEqual(f.allocation);
    expect(snapshot?.checkpoint).toBe(await offlineCheckpoint(allocationPayload(f.allocation)));
    expect(snapshot?.counters).toEqual([
      { lotId: 'free-1', committedUnits: 0n, reservedUnits: 0n },
      { lotId: 'welcome-1', committedUnits: 0n, reservedUnits: 0n },
    ]);
  });

  it('gives twenty replica retries one economic allocation and never resets stored usage', async () => {
    const f = await capacityFixture(open);
    const replica = await f.replica();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => [f.capacity.install(f.token), replica.install(f.token)]).flat(),
    );
    expect(results.filter((result) => result.status === 'installed')).toHaveLength(1);
    await f.options.connection.write(
      statement`UPDATE meter_capacity_usage SET committed_units = 1000000 WHERE lot_id = 'free-1'`,
    );
    await replica.install(f.token);
    expect((await f.capacity.snapshot())?.counters).toContainEqual({
      lotId: 'free-1',
      reservedUnits: 0n,
      committedUnits: 1_000_000n,
    });
  });

  it('keeps original source expiry and recovers an existing receipt after license expiry without creating capacity', async () => {
    const f = await capacityFixture(open);
    f.time.pass(10_000);
    await f.capacity.install(f.token);
    expect((await f.capacity.snapshot())?.allocation.sources).toEqual(f.allocation.sources);
    f.time.pass(f.allocation.expiresAt);
    expect(await f.capacity.install(f.token)).toMatchObject({ status: 'existing' });
    await expect(f.licenses.current(await f.clock.read())).rejects.toThrow('exp');
  });
}

function historyBehaviour(open: () => Promise<MeterDatabase>): void {
  it('refuses a new epoch while earlier capacity is unresolved and never refills a closed allocation', async () => {
    const f = await capacityFixture(open);
    await f.capacity.install(f.token);
    const next = { ...f.allocation, id: 'allocation-2', epoch: 2 };
    const token = await f.authorize(next);
    await expect(f.capacity.install(token)).rejects.toThrow('offline_allocation_unresolved');
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'closed'`);
    expect(await f.capacity.install(token)).toMatchObject({ id: next.id, epoch: 2, status: 'installed' });
    expect(await f.capacity.install(f.token)).toMatchObject({
      id: f.allocation.id,
      state: 'closed',
      status: 'existing',
    });
    expect((await f.capacity.snapshot())?.allocation.id).toBe(next.id);
  });

  it('keeps signed evidence immutable and constrains projections to original source capacity', async () => {
    const f = await capacityFixture(open);
    await f.capacity.install(f.token);
    await expect(
      f.options.connection.write(statement`UPDATE meter_capacity_history SET token = 'changed'`),
    ).rejects.toThrow('Offline capacity evidence is immutable');
    await expect(f.options.connection.write(statement`DELETE FROM meter_capacity_history`)).rejects.toThrow(
      'Offline capacity evidence is immutable',
    );
    await expect(
      f.options.connection.write(statement`UPDATE meter_capacity_sources SET units = units + 1`),
    ).rejects.toThrow('Offline capacity evidence is immutable');
    await expect(f.options.connection.write(statement`DELETE FROM meter_capacity_sources`)).rejects.toThrow(
      'Offline capacity evidence is immutable',
    );
    await expect(
      f.options.connection.write(statement`UPDATE meter_capacity_usage SET committed_units = capacity_units + 1`),
    ).rejects.toThrow(/constraint|CHECK/iu);
    await expect(
      f.options.connection.write(statement`UPDATE meter_capacity_usage SET capacity_units = capacity_units + 1`),
    ).rejects.toThrow(/foreign key|FOREIGN KEY/iu);
  });
}

function persistenceBehaviour(open: () => Promise<MeterDatabase>): void {
  it('recovers a committed allocation after a lost acknowledgement', async () => {
    const f = await capacityFixture(open);
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          await f.options.connection.transaction(sql);
          throw new Error('acknowledgement_lost');
        },
      },
    });
    expect(await capacity.install(f.token)).toMatchObject({ status: 'existing' });
    expect((await f.capacity.snapshot())?.counters).toHaveLength(2);
  });

  it('rolls back the head, evidence and every source when a late statement fails', async () => {
    const f = await capacityFixture(open);
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: (sql) =>
          f.options.connection.transaction([...sql, statement`INSERT INTO missing_capacity_table VALUES (1)`]),
      },
    });
    await expect(capacity.install(f.token)).rejects.toThrow('missing_capacity_table');
    expect(await f.capacity.snapshot()).toBeUndefined();
    expect(await f.options.connection.read(statement`SELECT id FROM meter_capacity_history`)).toEqual([]);
    expect(await f.options.connection.read(statement`SELECT lot_id FROM meter_capacity_usage`)).toEqual([]);
    expect(await f.capacity.install(f.token)).toMatchObject({ status: 'installed' });
  });
}

function maximumSourcesBehaviour(open: () => Promise<MeterDatabase>): void {
  it('uses a bounded digest lookup for a full 64-source signed allocation', async () => {
    const f = await capacityFixture(open);
    const large: OfflineAllocation = {
      ...f.allocation,
      sources: Array.from({ length: 64 }, (_, index) => ({
        lotId: `source_${index}_${'a'.repeat(40)}`,
        source: 'free',
        issuedAt: 1000,
        expiresAt: 20_000,
        units: 1_000_000n,
      })),
    };
    const token = await f.authorize(large);
    expect(token.length).toBeGreaterThan(2704);
    await f.capacity.install(token);
    expect((await f.capacity.snapshot())?.counters).toHaveLength(64);
    expect(await f.capacity.install(token)).toMatchObject({ status: 'existing' });
  });
}

function authorityBehaviour(open: () => Promise<MeterDatabase>): void {
  it('refuses installation if the license is refused before the capacity transaction commits', async () => {
    const f = await capacityFixture(open);
    const head = await f.licenses.head();
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          await f.licenses.refuse(head.revision);
          return f.options.connection.transaction(sql);
        },
      },
    });
    await expect(capacity.install(f.token)).rejects.toThrow('license_not_active');
    expect(await f.capacity.snapshot()).toBeUndefined();
  });

  it('refuses installation when the shared clock becomes suspect before commit', async () => {
    const f = await capacityFixture(open);
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          f.time.state.wall -= 10_000;
          await f.clock.read();
          return f.options.connection.transaction(sql);
        },
      },
    });
    await expect(capacity.install(f.token)).rejects.toThrow('license_clock_untrusted');
    expect(await f.capacity.snapshot()).toBeUndefined();
  });
}
