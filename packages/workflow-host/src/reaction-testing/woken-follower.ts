import { Effect, Function } from 'effect';
import { onTestFinished } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { followedPlaybooksOn, type FollowedPlaybook } from '../follower/followed-playbooks.ts';
import { closeHostParts, openHostParts } from '../host/host-parts.ts';
import { openWorkflowStore } from '../host/workflow-store.ts';
import { followerWakeUp } from '../reactions/host-reactions.ts';
import { connectedOn, type SettingsOf } from '../testing/host-files.ts';
import { followerPartsOf, type FollowerPartsOf } from './follower-parts.ts';
import { alpha, definitionRecorded, eventTrigger, playbookCreated, published } from './playbook-writes.ts';

export interface WokenFollower extends Omit<FollowerPartsOf, 'options'> {
  readonly woken: (now: number, sweep: boolean) => Promise<number | null>;
  readonly restarted: () => Promise<void>;
  readonly place: () => Promise<FollowedPlaybook | undefined>;
  readonly failingReads: (failing: (text: string) => boolean) => void;
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

export async function wokenFollowerOn(
  settingsOf: SettingsOf,
  startedAt: number,
  unread: Readonly<{ now: boolean }>,
): Promise<WokenFollower> {
  const time = { now: startedAt };
  const store = await openWorkflowStore(await connectedOn(await settingsOf()), []);
  const { through: placeAtOpen } = await store.database.store.readAppended(undefined, 0);
  await playbookCreated(store.database.store, 'alpha');
  await definitionRecorded(store.database.store, {
    name: 'watch',
    version: 1,
    triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
  });
  await published(store.database.store, { id: 's1', type: 'com.acme.sentinel' });
  const { options, ...recorded } = followerPartsOf(time, unread);
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
      time.now = now;
      return (await Effect.runPromise(current.wake.wakeUp({ now, sweep }))).nextDueAt;
    },
    restarted: async () => {
      await Effect.runPromise(current.wake.stop());
      current.wake = followerWakeUp(following, signal);
    },
    place: () => Effect.runPromise(followedPlaybooksOn(store.database).load(alpha)),
    failingReads: (when) => {
      failing.when = when;
    },
  };
}
