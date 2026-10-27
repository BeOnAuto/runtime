import { statement } from '@on.auto/ledger';
import { expect, it } from 'vitest';

import { openLicenseClock } from '../index.ts';
import { clockFixture } from './clock-fixture.ts';
import type { MeterDatabase } from './database.ts';

function elapsedClockBehaviour(open: () => Promise<MeterDatabase>): void {
  it('requires a trusted refresh before use and advances by elapsed time without changing its signed deadlines', async () => {
    const f = await clockFixture(open);
    expect(await f.clock.read()).toEqual({ now: 100_000, onlineRequired: true });
    expect(await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).toEqual({
      now: 200_000,
      onlineRequired: false,
    });
    f.time.pass(10_000);
    expect(await f.clock.read()).toEqual({ now: 210_000, onlineRequired: false });
    f.time.state.monotonic += 10_000;
    expect(await f.clock.read()).toEqual({ now: 220_000, onlineRequired: false });
    f.time.state.wall += 10_000;
    expect(await f.clock.read()).toEqual({ now: 220_000, onlineRequired: false });
    f.time.pass(1000);
    const replica = await f.replica();
    expect(await replica.read()).toEqual({ now: 221_000, onlineRequired: false });
  });

  it('persists a rollback refusal across replicas until a fresh trusted response re-establishes time', async () => {
    const f = await clockFixture(open);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    f.time.pass(20_000);
    expect((await f.clock.read()).now).toBe(220_000);
    f.time.state.wall -= 10_000;
    f.time.state.monotonic += 1000;
    expect(await f.clock.read()).toEqual({ now: 221_000, onlineRequired: true });
    f.time.pass(1000);
    const replica = await f.replica();
    expect((await replica.read()).onlineRequired).toBe(true);
    expect(await replica.synchronize({ id: 'refresh-2', serverTime: 222_000 })).toEqual({
      now: 222_000,
      onlineRequired: false,
    });
    expect((await f.clock.read()).onlineRequired).toBe(false);
  });
}

function restartedClockBehaviour(open: () => Promise<MeterDatabase>): void {
  it('keeps elapsed time advancing through a small wall adjustment but refuses a restart on a frozen clock', async () => {
    const f = await clockFixture(open);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    f.time.state.monotonic = 10_000;
    f.time.state.wall -= 1000;
    expect(await f.clock.read()).toEqual({ now: 210_000, onlineRequired: false });
    const replica = await f.replica();
    expect((await replica.read()).onlineRequired).toBe(true);
    expect((await f.clock.read()).onlineRequired).toBe(true);
    expect(await replica.synchronize({ id: 'refresh-2', serverTime: 210_000 })).toEqual({
      now: 210_000,
      onlineRequired: false,
    });
  });
}

function refreshClockBehaviour(open: () => Promise<MeterDatabase>): void {
  it('records one refresh across concurrent replicas and replays old receipts without rewinding or re-anchoring time', async () => {
    const f = await clockFixture(open);
    const replica = await f.replica();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => [
        f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 }),
        replica.synchronize({ id: 'refresh-1', serverTime: 200_000 }),
      ]).flat(),
    );
    expect(results.map((result) => result.now)).toEqual(Array.from({ length: 20 }, () => 200_000));
    expect(results.map((result) => result.onlineRequired)).toEqual(Array.from({ length: 20 }, () => false));
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes`)).toEqual([{ id: 'refresh-1' }]);
    f.time.pass(10_000);
    await replica.synchronize({ id: 'refresh-2', serverTime: 210_000 });
    f.time.pass(10_000);
    expect(await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).toEqual({
      now: 220_000,
      onlineRequired: false,
    });
    await expect(f.clock.synchronize({ id: 'refresh-1', serverTime: 220_000 })).rejects.toThrow(
      'license_clock_proof_conflict',
    );
    await expect(f.clock.synchronize({ id: 'refresh-old', serverTime: 199_000 })).rejects.toThrow(
      'license_clock_trust_regressed',
    );
  });
}

function recoveredClockBehaviour(open: () => Promise<MeterDatabase>): void {
  it('recovers an acknowledged refresh from its immutable identity after a lost transaction acknowledgement', async () => {
    const f = await clockFixture(open);
    const clock = await openLicenseClock(
      {
        ...f.connection,
        transaction: async (sql) => {
          await f.connection.transaction(sql);
          throw new Error('acknowledgement_lost');
        },
      },
      f.time.samples,
    );
    expect(await clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).toEqual({
      now: 200_000,
      onlineRequired: false,
    });
    f.time.pass(10_000);
    expect(await clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).toEqual({
      now: 210_000,
      onlineRequired: false,
    });
  });

  it('rolls back the clock and receipt together when the last transactional write fails', async () => {
    const f = await clockFixture(open);
    const clock = await openLicenseClock(
      {
        ...f.connection,
        transaction: (sql) =>
          f.connection.transaction([
            ...sql,
            statement`INSERT INTO missing_meter_clock_table (id) VALUES (1) RETURNING id`,
          ]),
      },
      f.time.samples,
    );
    await expect(clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).rejects.toThrow(
      'missing_meter_clock_table',
    );
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes`)).toEqual([]);
    expect((await f.clock.read()).onlineRequired).toBe(true);
    expect(await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).toEqual({
      now: 200_000,
      onlineRequired: false,
    });
  });
}

export function clockBehaviour(open: () => Promise<MeterDatabase>): void {
  elapsedClockBehaviour(open);
  restartedClockBehaviour(open);
  refreshClockBehaviour(open);
  recoveredClockBehaviour(open);
  it('refuses rewriting or deleting the trusted refresh history through direct database writes', async () => {
    const f = await clockFixture(open);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    await expect(f.connection.write(statement`UPDATE meter_clock_refreshes SET trusted_at = 0`)).rejects.toThrow(
      'Clock refresh receipts are immutable',
    );
    await expect(f.connection.write(statement`DELETE FROM meter_clock_refreshes`)).rejects.toThrow(
      'Clock refresh receipts are immutable',
    );
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes`)).toEqual([{ id: 'refresh-1' }]);
  });
}
