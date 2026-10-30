import { Effect, Function } from 'effect';

import { followedPlaybooksOn } from '../src/follower/followed-playbooks.ts';
import { passOf } from '../src/follower/playbook-pass.ts';
import { playbookRecordsOf } from '../src/follower/playbook-records.ts';
import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { definitionRecordsKeepingTheirOwnStops } from '../src/reaction-testing/own-stops.ts';
import { byAdmin, definitionRecorded, eventTrigger, published } from '../src/reaction-testing/playbook-writes.ts';
import { playbookSweepsOn, type PlaybookSweeps } from '../src/sweeps/playbook-sweeps.ts';
import { resultOfEnding } from '../src/waiting-testing/recorded-waiting.ts';
import { servedWaitingOf } from '../src/waiting/waiting-parts.ts';

export interface SweepCost {
  readonly playbooks: number;
  readonly reacting: number;
  readonly roundMs: number;
  readonly idleMs: number;
  readonly changedMs: number;
}

type Pass = ReturnType<typeof passOf>;

const idleSweeps = 20;

function playbookKeyOf(index: number): string {
  return `playbook/acme/b${index}/`;
}

function inTurn(count: number, step: (index: number) => Promise<unknown>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (before, index) => before.then(() => step(index)).then(Function.constVoid),
    Promise.resolve(),
  );
}

function sweptUntilEmpty(sweeps: PlaybookSweeps, pass: Pass): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (;;) {
      const sweep = yield* sweeps.next();
      if (sweep.playbooks.length === 0) {
        return;
      }
      yield* Effect.forEach(sweep.playbooks, ({ playbookKey, known }) => pass(playbookKey, 'sweep', known), {
        discard: true,
      });
    }
  });
}

async function timed(work: Effect.Effect<void>): Promise<number> {
  const began = performance.now();
  await Effect.runPromise(work);
  return performance.now() - began;
}

function medianOf(times: readonly number[]): number {
  return times.toSorted((left, right) => left - right)[Math.floor(times.length / 2)] ?? 0;
}

export async function sweepCostOn(database: DatabaseSettings, playbooks: number, reacting: number): Promise<SweepCost> {
  const opened = await hostDatabaseOpenedOn(database);
  const followed = followedPlaybooksOn(opened);
  await inTurn(playbooks, async (index) => {
    await published(opened.store, { id: `e${index}`, type: 'com.measure.other' }, byAdmin, playbookKeyOf(index));
    await Effect.runPromise(followed.follow(playbookKeyOf(index), null));
  });
  await inTurn(reacting, (index) =>
    definitionRecorded(
      opened.store,
      { name: 'react', version: 1, triggers: [eventTrigger({ type: 'com.measure.wanted' })] },
      playbookKeyOf(index),
    ),
  );
  const pass = passOf({
    database: opened,
    records: playbookRecordsOf(opened.store),
    playbooks: followed,
    consumers: [],
    calls: servedWaitingOf({
      database: opened,
      submitted: Effect.die,
      resultOf: resultOfEnding,
      cancelDeferred: () => Effect.void,
      workflows: 'workflow',
      now: Date.now,
      trouble: () => Effect.void,
    }).calls,
    definitionType: 'workflow',
    applyDefinitionRecord: definitionRecordsKeepingTheirOwnStops(opened),
    unreadable: () => Effect.void,
    passedEarly: () => Effect.void,
    registered: [],
  });
  const sweeps = playbookSweepsOn(opened.store, followed);
  await Effect.runPromise(sweeps.started());
  const roundMs = await timed(sweptUntilEmpty(sweeps, pass));
  const idle: number[] = [];
  await inTurn(idleSweeps, async () => {
    idle.push(await timed(sweptUntilEmpty(sweeps, pass)));
  });
  await inTurn(playbooks, (index) =>
    published(opened.store, { id: `n${index}`, type: 'com.measure.other' }, byAdmin, playbookKeyOf(index)),
  );
  const changedMs = await timed(sweptUntilEmpty(sweeps, pass));
  await opened.close();
  return { playbooks, reacting, roundMs, idleMs: medianOf(idle), changedMs };
}
