import { Effect, Function } from 'effect';
import { onTestFinished } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { followedPlaybooksOn, type FollowedPlaybook, type Hold } from '../follower/followed-playbooks.ts';
import { closeHostParts, openHostParts } from '../host/host-parts.ts';
import { openWorkflowStore } from '../host/workflow-store.ts';
import { followerWakeUp } from '../reactions/host-reactions.ts';
import { connectedOn, type SettingsOf } from '../testing/host-files.ts';
import { followerPartsOf, type FollowerPartsOf, type MovingTime } from './follower-parts.ts';
import { alpha, definitionRecorded, eventTrigger, playbookCreated, published } from './playbook-writes.ts';

export interface WokenFollower extends Omit<FollowerPartsOf, 'options'> {
  readonly woken: (now: number, sweep: boolean) => Promise<number | null>;
  readonly restarted: () => Promise<void>;
  readonly place: () => Promise<FollowedPlaybook | undefined>;
  readonly heldAs: (hold: Hold) => Promise<void>;
  readonly failingReads: (failing: (text: string) => boolean) => void;
  readonly startsTake: (milliseconds: number) => void;
}

function readsFailingWhen(
  database: HostDatabase,
  failing: Readonly<{ when: (text: string) => boolean }>,
): HostDatabase {
  return {
    ...database,
    read: (asked) =>
      Effect.suspend(() =>
        failing.when(asked.strings.join('?'))
          ? Effect.fail(new DatabaseFailed({ detail: 'The test failed this read' }))
          : database.read(asked),
      ),
  };
}

function movingTimeFrom(start: number): MovingTime {
  const time = { now: start };
  return {
    now: () => time.now,
    moved: (milliseconds) => {
      time.now += milliseconds;
    },
  };
}

export async function wokenFollowerOn(
  settingsOf: SettingsOf,
  startedAt: number,
  unread: Readonly<{ now: boolean }>,
): Promise<WokenFollower> {
  const time = movingTimeFrom(startedAt);
  const store = await openWorkflowStore(await connectedOn(await settingsOf()), []);
  const { through: placeAtOpen } = await store.database.store.readAppended(undefined, 0);
  await playbookCreated(store.database.store, 'alpha');
  await definitionRecorded(store.database.store, {
    name: 'watch',
    version: 1,
    triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
  });
  await published(store.database.store, { id: 's1', type: 'com.acme.sentinel' });
  const takesMs = { now: 0 };
  const { options, ...recorded } = followerPartsOf(time, { unread, takesMs });
  const parts = openHostParts(store, options, Function.constVoid);
  const failing = { when: (_text: string) => false };
  const database = readsFailingWhen(store.database, failing);
  const following = { database, parts, reactions: options.reactions, reports: options.reports, placeAtOpen };
  const signal = { raised: Function.constVoid, renewed: Function.constVoid };
  const current = { wake: followerWakeUp(following, signal) };
  onTestFinished(async () => {
    await Effect.runPromise(current.wake.stop());
    await closeHostParts(parts);
  });
  return {
    ...recorded,
    woken: async (now, sweep) => {
      time.moved(now - time.now());
      return (await Effect.runPromise(current.wake.wakeUp({ now, sweep }))).nextDueAt;
    },
    restarted: async () => {
      await Effect.runPromise(current.wake.stop());
      current.wake = followerWakeUp(following, signal);
    },
    place: () => Effect.runPromise(followedPlaybooksOn(store.database).load(alpha)),
    heldAs: (hold) => Effect.runPromise(followedPlaybooksOn(store.database).held(alpha, hold)),
    failingReads: (when) => {
      failing.when = when;
    },
    startsTake: (milliseconds) => {
      takesMs.now = milliseconds;
    },
  };
}
