import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { attemptLeaseMsFor } from '../lease/attempt-leases.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import {
  first,
  firstKey,
  heldBy,
  lastsMs,
  second,
  secondKey,
  sharedOn,
  started,
  steppedThrough,
  sweepEveryMs,
  type Shared,
} from './attempt-lease-holders.ts';

function renewedThroughTenLeases(shared: Shared): Promise<readonly (readonly string[])[]> {
  const sweeps = Array.from({ length: (10 * lastsMs) / sweepEveryMs });
  return Effect.runPromise(
    Effect.forEach(sweeps, () =>
      Effect.promise(async () => {
        shared.later(sweepEveryMs);
        await shared.renewedBy('process-a');
        return shared.sweptBy('process-b');
      }),
    ),
  );
}

export function attemptLeaseSuite(settingsOf: SettingsOf): void {
  it('takes the lease of an attempt before its start, names it by the token its start took, and lets it go at its end', async () => {
    const shared = await sharedOn(settingsOf);
    const process = shared.processNamed('process-a');

    await steppedThrough(first, process.taken);
    const beforeItsStart = await shared.rows();
    await steppedThrough(first, (key) => process.named(key, 1));
    const held = await shared.rows();
    await steppedThrough(first, process.released);

    expect(beforeItsStart).toEqual([
      { name: `attempt/${firstKey}/process-a`, holder: 'process-a', expires_at: started + lastsMs },
    ]);
    expect(held).toEqual([
      { name: `attempt/${firstKey}/process-a/1`, holder: 'process-a', expires_at: started + lastsMs },
    ]);
    expect(await shared.rows()).toEqual([]);
  });

  it('lasts three sweeps, and never less than thirty seconds', () => {
    expect([attemptLeaseMsFor(10), attemptLeaseMsFor(1000), attemptLeaseMsFor(60_000)]).toEqual([
      30_000, 30_000, 180_000,
    ]);
  });

  it('is renewed by its own holder alone, whether or not it has lapsed, and named by nobody who took none', async () => {
    const shared = await sharedOn(settingsOf);
    await steppedThrough(first, shared.processNamed('process-a').taken);
    await steppedThrough(second, shared.processNamed('process-b').taken, (key) =>
      shared.processNamed('process-c').named(key, 4),
    );

    shared.later(2 * lastsMs);
    await shared.renewedBy('process-a');

    expect(await shared.rows()).toEqual([
      { name: `attempt/${firstKey}/process-a`, holder: 'process-a', expires_at: started + 3 * lastsMs },
      { name: `attempt/${secondKey}/process-b`, holder: 'process-b', expires_at: started + lastsMs },
    ]);
  });
}

export function liveHolderSuite(settingsOf: SettingsOf): void {
  it('of a holder that renews through a call ten times as long as the lease, is never ended', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-a'), first, 1);

    const sweeps = await renewedThroughTenLeases(shared);

    expect(sweeps.flat()).toEqual([]);
    expect(shared.ended()).toEqual([]);
  });

  it('of the process that sweeps, is never ended by it, however long it lapsed', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-b'), first, 1);

    shared.later(10 * lastsMs);

    expect(await shared.sweptBy('process-b')).toEqual([]);
    expect(await shared.soonestFor('process-b')).toBeNull();
  });

  it('of every process, after a restart, ends the attempts of the one that died and none of one that lives', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-a'), first, 1);
    await heldBy(shared.processNamed('process-c'), second, 1);

    const soonest = await shared.soonestFor('process-b');
    shared.later(sweepEveryMs);
    await shared.renewedBy('process-c');
    shared.later(lastsMs - sweepEveryMs + 1);
    await shared.renewedBy('process-c');
    await shared.sweptBy('process-b');

    expect(soonest).toBe(started + lastsMs);
    expect(shared.ended()).toEqual([[firstKey, 1]]);
  });
}

export function lapsedLeaseSuite(settingsOf: SettingsOf): void {
  it('of a holder that stopped renewing, is ended by the token it names once it lapsed, and let go', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-a'), first, 1);

    shared.later(lastsMs);
    const beforeItLapsed = await shared.sweptBy('process-b');
    shared.later(1);
    const afterItLapsed = await shared.sweptBy('process-b');

    expect(beforeItLapsed).toEqual([]);
    expect(afterItLapsed).toEqual([`attempt/${firstKey}/process-a/1`]);
    expect(shared.ended()).toEqual([[firstKey, 1]]);
    expect(await shared.rows()).toEqual([]);
  });

  it('of an attempt a retry in another process replaced, names the first attempt, which the core answers not running, and leaves the retry be', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-a'), first, 1);
    await heldBy(shared.processNamed('process-c'), first, 2);
    shared.answering({ receipt: 'not_running' });

    shared.later(lastsMs + 1);
    await shared.renewedBy('process-c');
    await shared.sweptBy('process-b');

    expect(shared.ended()).toEqual([[firstKey, 1]]);
    expect(await shared.rows()).toEqual([
      { name: `attempt/${firstKey}/process-c/2`, holder: 'process-c', expires_at: started + 2 * lastsMs + 1 },
    ]);
  });
}

export function handedOverLeaseSuite(settingsOf: SettingsOf): void {
  it('of an attempt of a run that outlives its call, has the run resumed at once', async () => {
    const shared = await sharedOn(settingsOf);
    await heldBy(shared.processNamed('process-a'), first, 1);
    shared.answering({ receipt: 'outlives_its_call' });

    shared.later(lastsMs + 1);
    await shared.sweptBy('process-b');

    expect(shared.resumed()).toEqual([firstKey]);
    expect(await shared.rows()).toEqual([]);
  });

  it('handed over by a live process at the end of an attempt that recorded no ending, is judged at the next sweep', async () => {
    const shared = await sharedOn(settingsOf);
    const live = shared.processNamed('process-a');
    await heldBy(live, first, 3);
    await steppedThrough(first, live.handedOver);

    const swept = await shared.sweptBy('process-a');

    expect(swept).toEqual([`attempt/${firstKey}/process-a/3`]);
    expect(shared.ended()).toEqual([[firstKey, 3]]);
    expect(await shared.rows()).toEqual([]);
  });

  it('named again by a later attempt of this process under the token of one it handed over, takes the place of that one', async () => {
    const shared = await sharedOn(settingsOf);
    const live = shared.processNamed('process-a');
    await heldBy(live, first, 3);
    await steppedThrough(first, live.handedOver);

    await heldBy(live, first, 3);

    expect(await shared.rows()).toEqual([
      { name: `attempt/${firstKey}/process-a/3`, holder: 'process-a', expires_at: started + lastsMs },
    ]);
  });
}
