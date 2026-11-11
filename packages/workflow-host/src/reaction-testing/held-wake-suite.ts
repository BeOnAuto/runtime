import { messageIdOf } from '@on.auto/operations';
import { Effect, Function } from 'effect';
import { expect, it, onTestFinished } from 'vitest';

import { followerWakeUpOf } from '../follower/follower-wake-up.ts';
import { failedTryRetryMs } from '../holds/playbook-holds.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { dueAfterThem, failingFirst, heldInTurnOn } from './held-in-turn.ts';
import { alpha, at } from './playbook-writes.ts';
import { wokenFollowerOn, type WokenFollower } from './woken-follower.ts';

const startedAt = Date.parse(at) + 1000;

async function wokenUntilHeld(follower: WokenFollower, wakes: number): Promise<number | null> {
  const dueAt = await follower.woken(startedAt, wakes === 0);
  const place = await follower.place();
  return place?.hold !== undefined || wakes >= 4 ? dueAt : wokenUntilHeld(follower, wakes + 1);
}

async function heldFollowerOn(settingsOf: SettingsOf) {
  const unread = { now: true };
  const follower = await wokenFollowerOn(settingsOf, startedAt, unread);
  const heldDueAt = Number(await wokenUntilHeld(follower, 0));
  return { follower, heldDueAt, unread };
}

const heldRead = (text: string): boolean => text.includes('held_until IS NOT NULL');

function triedAgainAfterFailedRounds(settingsOf: SettingsOf) {
  it('asks to be woken a minute after a round that failed and twice as long after the next, through a restart whose sweep tries its hold, tries it again at the wake after one that succeeds, and a minute again after the next that fails', async () => {
    const { follower } = await heldFollowerOn(settingsOf);
    const failedAt = startedAt + 10;

    follower.failingReads(heldRead);
    const firstDueAt = Number(await follower.woken(failedAt, false));
    await follower.restarted();
    const secondDueAt = Number(await follower.woken(firstDueAt, true));
    follower.failingReads(() => false);
    await follower.woken(secondDueAt, false);
    follower.failingReads(heldRead);
    const thirdDueAt = Number(await follower.woken(secondDueAt + 1, false));

    expect([firstDueAt - failedAt, secondDueAt - firstDueAt, thirdDueAt - secondDueAt - 1]).toEqual([
      60_000, 120_000, 60_000,
    ]);
    expect(follower.troubles()).toContain(
      'The follower of the playbooks failed; it tries again in a minute, twice as long after each round that fails in a row, at most an hour',
    );
    expect((await follower.place())?.hold).toMatchObject({ holds: 3, heldFor: 'content' });
  });
}

function triedAgainAfterAFailedTry(settingsOf: SettingsOf) {
  it('asks to be woken within a minute after a try of its hold whose pass failed, says the try failed, and at that wake lifts the hold once the content is read', async () => {
    const { follower, heldDueAt, unread } = await heldFollowerOn(settingsOf);

    follower.failingReads((text) => text.includes('workflow_listener_types'));
    const dueAt = await follower.woken(heldDueAt, false);
    const startsWhileFailing = follower.starts();
    follower.failingReads(() => false);
    unread.now = false;
    await follower.woken(heldDueAt + failedTryRetryMs, false);

    expect(dueAt).toBe(heldDueAt + failedTryRetryMs);
    expect(follower.notes().filter(({ kind }) => kind === 'content_hold_try_failed')).toMatchObject([
      { org: 'acme', playbook: 'alpha', heldFor: 'content', holds: 1, retryAt: heldDueAt + failedTryRetryMs },
    ]);
    expect([startsWhileFailing, follower.starts()]).toEqual([[], [messageIdOf(`${alpha}events/s1`, 1)]]);
    expect((await follower.place())?.hold).toBeUndefined();
  });
}

function triedInTurn(settingsOf: SettingsOf) {
  it('tries every hold due over the wakes that follow, though the 64 due first fail at every try, and is next due when their next tries are', async () => {
    const inTurn = await heldInTurnOn(settingsOf, startedAt);
    const wake = followerWakeUpOf(inTurn.work, { raised: Function.constVoid, renewed: Function.constVoid });
    onTestFinished(() => Effect.runPromise(wake.stop()));

    const answers = [
      await Effect.runPromise(wake.wakeUp({ now: startedAt, sweep: true })),
      await Effect.runPromise(wake.wakeUp({ now: startedAt, sweep: false })),
    ];

    expect(inTurn.passed).toEqual([dueAfterThem]);
    expect(inTurn.failedTries).toEqual(failingFirst);
    expect(answers).toEqual([{ nextDueAt: startedAt }, { nextDueAt: startedAt + failedTryRetryMs }]);
  });
}

export function heldWakeSuite(settingsOf: SettingsOf): void {
  triedAgainAfterFailedRounds(settingsOf);
  triedAgainAfterAFailedTry(settingsOf);
  triedInTurn(settingsOf);
}
