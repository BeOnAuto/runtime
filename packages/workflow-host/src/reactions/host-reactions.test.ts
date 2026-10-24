import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { closeHostParts, followerWakeUp, openHostParts, openWorkflowStore, type NextWake } from '../index.ts';
import { systemClock } from '../loop/host-clock.ts';
import { definitionRecorded, eventTrigger, published } from '../reaction-testing/playbook-writes.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { aSQLiteFile, connectedOn } from '../testing/host-files.ts';
import { recordedOptionsOf } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

describe('the follower of a host composed by a clock of its own', () => {
  it('starts a workflow its trigger matches when it is woken, over parts opened alone, with no loop and no claim', async () => {
    const store = await openWorkflowStore(await connectedOn({ store: 'sqlite', file: aSQLiteFile() }), []);
    const { through: placeAtOpen } = await store.database.store.readAppended(undefined, 0);
    const { options, troubles } = recordedOptionsOf();
    const reactions = recordedReactions();
    const parts = openHostParts(store, { ...options, clock: systemClock }, Function.constVoid);
    const raised = { times: 0 };
    const follower = followerWakeUp(
      { database: store.database, parts, reactions: reactions.options, reports: options.reports, placeAtOpen },
      {
        raised: () => {
          raised.times += 1;
        },
        renewed: Function.constVoid,
      },
    );
    onTestFinished(async () => {
      await Effect.runPromise(follower.stop());
      await closeHostParts(parts);
    });
    const wakeUp = (sweep: boolean): Promise<NextWake> =>
      Effect.runPromise(follower.wakeUp({ now: Date.now(), sweep }));

    const atStart = await wakeUp(true);
    await definitionRecorded(store.database.store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    await published(store.database.store, { id: 'e1', type: 'com.acme.closed' });
    const starts = await until(
      async () => {
        await wakeUp(false);
        return reactions.starts();
      },
      (found) => found.length > 0,
    );

    expect([atStart, starts.map(({ workflow, depth }) => [workflow, depth]), troubles()]).toEqual([
      { nextDueAt: null },
      [['close', 1]],
      [],
    ]);
    expect(raised.times).toBeGreaterThan(0);
  });
});
