import type { RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { insertedListener, runPassedThrough } from '../listeners/listener-rows.ts';
import {
  deliveringEach,
  finishedAt,
  finishesRead,
  lastPageOf,
  listenerFor,
  passingOn,
  playbookKey,
  recordAt,
} from '../reaction-testing/playbook-passes.ts';

function finishedPassingOn(
  page: (database: HostDatabase) => (read: number) => Effect.Effect<readonly RecordedEvent[]>,
  readOn: (database: HostDatabase) => Effect.Effect<void> = () => Effect.void,
) {
  const delivered: string[] = [];
  const opening = passingOn((database) => ({
    records: lastPageOf(page(database)),
    consumers: [
      deliveringEach((id) => {
        delivered.push(id);
      }),
    ],
    calls: [finishesRead(readOn(database))],
    passedEarly: () => Effect.void,
  }));
  return { delivered, opening };
}

async function passedOnce(opening: ReturnType<typeof passingOn>) {
  const { playbooks, pass } = await opening;
  await Effect.runPromise(playbooks.follow(playbookKey, null));
  const end = await Effect.runPromise(pass(playbookKey, 'signal'));
  const followed = await Effect.runPromise(playbooks.load(playbookKey));
  return { end, cursor: followed?.cursor };
}

function listenedBeforeTheSecondRead(database: HostDatabase) {
  const listened = Effect.orDie(
    runPassedThrough(database, 'acme/alpha/r-1', 1).pipe(
      Effect.andThen(insertedListener(database, { ...listenerFor('run_succeeded'), passed: false })),
    ),
  );
  return (read: number) => Effect.as(read === 1 ? Effect.void : listened, [finishedAt(1)]);
}

function armedWhileTheFirstIsRead(database: HostDatabase) {
  return Effect.orDie(
    insertedListener(database, { ...listenerFor('run_succeeded'), passed: false }).pipe(
      Effect.andThen(sqlWatermark(database).advance('acme/alpha/r-1', 1)),
    ),
  );
}

describe('a pass over facts that another consumer reads, of a type no trigger or listener named as it began', () => {
  it('hands them to no consumer of the reactions while none names their type', async () => {
    const { delivered, opening } = finishedPassingOn(() => () => Effect.succeed([finishedAt(1), finishedAt(2)]));

    const passed = await passedOnce(opening);

    expect([passed, delivered]).toEqual([{ end: 'caught_up', cursor: 'cursor-2' }, []]);
  });

  it('hands the next of them to the consumers of the reactions once a listener made live by its own insert names their type', async () => {
    const { delivered, opening } = finishedPassingOn(listenedBeforeTheSecondRead);

    await passedOnce(opening);

    expect(delivered).toEqual(['record-1']);
  });

  it('hands the next of them to the consumers of the reactions once the pass made live a listener that names their type', async () => {
    const { delivered, opening } = finishedPassingOn(
      () => () => Effect.succeed([finishedAt(1), recordAt('run-logs/r-1', 2), finishedAt(3)]),
      armedWhileTheFirstIsRead,
    );

    await passedOnce(opening);

    expect(delivered).toEqual(['record-3']);
  });
});
