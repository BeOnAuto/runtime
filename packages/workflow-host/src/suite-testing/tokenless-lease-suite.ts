import { expect, it } from 'vitest';

import { attemptLeasesOn, attemptLeasesOver } from '../lease/attempt-leases.ts';
import { connectedOn, openedOn, type SettingsOf } from '../testing/host-files.ts';
import {
  first,
  firstKey,
  heldBy,
  lastsMs,
  leaseRowsOn,
  sharedOn,
  steppedThrough,
  sweepEveryMs,
} from './attempt-lease-holders.ts';

export function tokenlessLeaseSuite(settingsOf: SettingsOf): void {
  it('of a holder that died before its start told its token, ends the attempt that holds the run, no other live lease naming it', async () => {
    const shared = await sharedOn(settingsOf);
    await steppedThrough(first, shared.processNamed('process-a').taken);
    shared.answering({ holding: 1 });

    shared.later(lastsMs + 1);
    await shared.sweptBy('process-b');

    expect(shared.ended()).toEqual([[firstKey, 1]]);
    expect(await shared.rows()).toEqual([]);
  });

  it('of a holder that died before it started a run, ends nothing where no attempt holds the run', async () => {
    const shared = await sharedOn(settingsOf);
    await steppedThrough(first, shared.processNamed('process-a').taken);

    shared.later(lastsMs + 1);
    await shared.sweptBy('process-b');

    expect(shared.ended()).toEqual([]);
    expect(await shared.rows()).toEqual([]);
  });
}

export function tokenlessBesideLeaseSuite(settingsOf: SettingsOf): void {
  it('ends nothing where a live lease of another process names the attempt that holds the run', async () => {
    const shared = await sharedOn(settingsOf);
    await steppedThrough(first, shared.processNamed('process-a').taken);
    await heldBy(shared.processNamed('process-c'), first, 2);
    shared.answering({ holding: 2 });

    shared.later(lastsMs + 1);
    await shared.renewedBy('process-c');
    await shared.sweptBy('process-b');

    expect(shared.ended()).toEqual([]);
    expect((await shared.rows()).map(({ name }) => name)).toEqual([`attempt/${firstKey}/process-c/2`]);
  });

  it('waits while a live lease of another process names no token yet, since that attempt may hold the run, and lets it go once that one names the holder', async () => {
    const shared = await sharedOn(settingsOf);
    const starting = shared.processNamed('process-c');
    await steppedThrough(first, shared.processNamed('process-a').taken);
    await steppedThrough(first, starting.taken);
    shared.answering({ holding: 2 });

    shared.later(lastsMs + 1);
    await shared.renewedBy('process-c');
    const whileUnnamed = await shared.sweptBy('process-b');
    const leftMeanwhile = (await shared.rows()).map(({ name }) => name);
    await steppedThrough(first, (key) => starting.named(key, 2));
    await shared.sweptBy('process-b');

    expect(whileUnnamed).toEqual([`attempt/${firstKey}/process-a`]);
    expect(leftMeanwhile).toEqual([`attempt/${firstKey}/process-a`, `attempt/${firstKey}/process-c`]);
    expect(shared.ended()).toEqual([]);
    expect((await shared.rows()).map(({ name }) => name)).toEqual([`attempt/${firstKey}/process-c/2`]);
  });
}

export function systemClockLeaseSuite(settingsOf: SettingsOf): void {
  it('taken over the connection of the ledger, as the server takes it, is the same lease', async () => {
    const settings = await settingsOf();
    const database = await openedOn(settings);
    const leases = attemptLeasesOver(await connectedOn(settings), { holder: 'process-a', sweepEveryMs });

    await steppedThrough(first, leases.taken, (key) => leases.named(key, 1));

    expect((await leaseRowsOn(database)).map(({ name }) => name)).toEqual([`attempt/${firstKey}/process-a/1`]);
  });

  it('let go by a process that took it for an attempt it then handed on, is let go by its name before a token', async () => {
    const database = await openedOn(await settingsOf());
    await steppedThrough(first, attemptLeasesOn(database, { holder: 'process-a', sweepEveryMs }).taken);

    await steppedThrough(first, attemptLeasesOn(database, { holder: 'process-a', sweepEveryMs }).released);

    expect(await leaseRowsOn(database)).toEqual([]);
  });

  it('is no work that calls outside, so the sweep hands none to the lane of calls out', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-a'), first, 1);

    shared.later(lastsMs + 1);

    expect(await shared.forCallsOut('process-b')).toEqual([[], null]);
  });

  it('taken by a process that names no clock, lasts from the clock of its database or of its computer', async () => {
    const database = await openedOn(await settingsOf());
    const before = Date.now();

    await steppedThrough(first, attemptLeasesOn(database, { holder: 'process-a', sweepEveryMs }).taken);
    const [lease] = await leaseRowsOn(database);

    expect(lease?.expires_at).toBeGreaterThanOrEqual(before + lastsMs - 1000);
    expect(lease?.expires_at).toBeLessThanOrEqual(Date.now() + lastsMs + 1000);
  });
}
