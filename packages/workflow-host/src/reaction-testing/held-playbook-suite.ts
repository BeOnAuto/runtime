import { messageIdOf } from '@on.auto/operations';
import { expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import {
  causesOf,
  heldUntil,
  holdReaching,
  notesReaching,
  waitedFor,
  type Holding,
  type HoldState,
} from './followed-rows.ts';
import { movedClock } from './moved-clock.ts';
import { alpha, at, definitionRecorded, eventTrigger, published } from './playbook-writes.ts';
import { reactingHost } from './reacting-host.ts';
import { unreadWhile } from './recorded-reactions.ts';

const startedAt = Date.parse(at) + 1000;

async function sentinelsHeldWhile(settingsOf: SettingsOf, unread: Readonly<{ now: boolean }>): Promise<Holding> {
  const clock = movedClock(startedAt);
  const reacting = await reactingHost({ settings: await settingsOf(), clock, failure: unreadWhile(unread) });
  const { store } = reacting.database;
  await definitionRecorded(store, {
    name: 'watch',
    version: 1,
    triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
  });
  await published(store, { id: 's1', type: 'com.acme.sentinel' });
  await published(store, { id: 's2', type: 'com.acme.sentinel' });
  return { reacting, clock };
}

function sentinel(id: string): string {
  return messageIdOf(`${alpha}events/${id}`, 1);
}

async function waitsOfTheTries(
  holding: Holding,
  first: HoldState,
  tries: readonly number[],
): Promise<readonly number[]> {
  const { waits } = await tries.reduce<Promise<{ readonly state: HoldState; readonly waits: readonly number[] }>>(
    async (before, holds) => {
      const { state, waits: earlier } = await before;
      const tried = heldUntil(state);
      holding.clock.moveTo(tried);
      const next = await holdReaching(holding, (found) => found.holds === holds);
      return { state: next, waits: [...earlier, waitedFor(next, tried)] };
    },
    Promise.resolve({ state: first, waits: [] }),
  );
  return waits;
}

function onTheSchedule(waits: readonly number[]): readonly boolean[] {
  return waits.map((wait, index) => wait >= 500 * 2 ** (index + 1) && wait <= 1000 * 2 ** (index + 1));
}

function heldAtTheFirstStart(settingsOf: SettingsOf) {
  it('holds the playbook at the record whose start could not read its workflow, keeps the hold in its row, and starts nothing behind it', async () => {
    const holding = await sentinelsHeldWhile(settingsOf, { now: true });

    const held = await holdReaching(holding, (state) => state.holds === 1);

    expect(held).toMatchObject({ held_since: startedAt, holds: 1, held_for: 'content', attempts: 0, waiting: 1 });
    expect(waitedFor(held, startedAt)).toBeGreaterThanOrEqual(500);
    expect(waitedFor(held, startedAt)).toBeLessThanOrEqual(1000);
    expect(causesOf(holding)).toEqual([]);
    expect(await notesReaching(holding, 'content_hold', 1)).toMatchObject([
      {
        org: 'acme',
        playbook: 'alpha',
        heldFor: 'content',
        heldSince: startedAt,
        heldMs: 0,
        holds: 1,
        heldUntil: heldUntil(held),
        recordId: sentinel('s1'),
        type: 'event_published',
      },
    ]);
  });
}

function triedOnTheSchedule(settingsOf: SettingsOf) {
  it('tries it again once its time has come, twice as long after each try, never counting a try as an attempt', async () => {
    const holding = await sentinelsHeldWhile(settingsOf, { now: true });
    const first = await holdReaching(holding, (state) => state.holds === 1);

    const waits = await waitsOfTheTries(holding, first, [2, 3, 4]);

    expect(onTheSchedule(waits)).toEqual([true, true, true]);
    expect(await holdReaching(holding, (state) => state.holds === 4)).toMatchObject({
      held_since: startedAt,
      attempts: 0,
      held_for: 'content',
    });
    expect((await notesReaching(holding, 'content_hold', 4)).at(-1)).toMatchObject({
      holds: 4,
      lag: 2,
      lagCapped: false,
    });
    expect(causesOf(holding)).toEqual([]);
  });
}

function keptThroughARestart(settingsOf: SettingsOf) {
  it('keeps the hold through a restart, passing the playbook over until its time, then lifts it and delivers every record behind it in order', async () => {
    const unread = { now: true };
    const first = await sentinelsHeldWhile(settingsOf, unread);
    const held = await holdReaching(first, (state) => state.holds === 1);
    await first.reacting.host.stop();
    unread.now = false;
    const reacting = await reactingHost({
      settings: first.reacting.settings,
      clock: first.clock,
      failure: unreadWhile(unread),
    });
    const second: Holding = { reacting, clock: first.clock };
    const restarted = await holdReaching(second, (state) => state.holds === 1);
    await published(reacting.database.store, { id: 's3', type: 'com.acme.sentinel' });

    const passedOver = await holdReaching(second, (state) => state.checked >= restarted.checked + 2);
    const startsWhileHeld = causesOf(second);
    first.clock.moveTo(heldUntil(held));
    const lifted = await holdReaching(second, (state) => state.holds === 0);
    const delivered = await until(
      () => Promise.resolve(causesOf(second)),
      (causes) => causes.length === 3,
    );

    expect([passedOver.holds, passedOver.held_until, startsWhileHeld]).toEqual([1, held.held_until, []]);
    expect(lifted).toMatchObject({ held_since: null, held_until: null, holds: 0, held_for: null, attempts: 0 });
    expect(delivered).toEqual([sentinel('s1'), sentinel('s2'), sentinel('s3')]);
    expect(await notesReaching(second, 'content_hold_lifted', 1)).toMatchObject([
      {
        org: 'acme',
        playbook: 'alpha',
        heldFor: 'content',
        heldSince: startedAt,
        heldMs: heldUntil(held) - startedAt,
        holds: 1,
        records: 3,
        more: false,
      },
    ]);
  });
}

export function heldPlaybookSuite(settingsOf: SettingsOf): void {
  heldAtTheFirstStart(settingsOf);
  triedOnTheSchedule(settingsOf);
  keptThroughARestart(settingsOf);
}
