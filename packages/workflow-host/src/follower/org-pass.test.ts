import type { RecordedEvent } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { insertedListener } from '../listeners/listener-rows.ts';
import {
  deliveringEach,
  listenerFor,
  org,
  passingOn,
  placeOfTheTests,
  playbookKey,
  recordAt,
} from '../reaction-testing/playbook-passes.ts';
import type { RecordConsumer } from './consumers.ts';
import type { Hold, ParkedPlaybook } from './followed-orgs.ts';
import type { PassParts } from './org-pass.ts';

interface CountedRecords {
  readonly records: PassParts['records'];
  readonly reads: () => readonly boolean[];
}

function countedRecords(pageAt: (read: number) => Effect.Effect<readonly RecordedEvent[]>): CountedRecords {
  const reads: boolean[] = [];
  return {
    records: {
      after: (_playbook, _cursor, delivers) =>
        Effect.suspend(() => {
          reads.push(delivers.size > 0);
          return Effect.map(pageAt(reads.length), (records) => ({
            records,
            hasMore: true,
            nextCursor: null,
            lastExamined: null,
          }));
        }),
    },
    reads: () => reads,
  };
}

function publishedAt(position: number): RecordedEvent {
  const event = {
    specversion: '1.0',
    id: `e${position}`,
    source: '/acme',
    type: 'com.acme.noted',
    time: '2026-10-01T09:00:00.000Z',
  };
  return {
    ...recordAt(`events/e${position}`, position),
    type: 'event_published',
    data: { type: 'event_published', event, filled: [], by: 'acme-admin', at: event.time },
  };
}

function publishedThenGone(): CountedRecords {
  return countedRecords((read) =>
    read <= 2 ? Effect.succeed([publishedAt(1), publishedAt(2)]) : Effect.die(new Error('The ledger went away')),
  );
}

function undispatchedRun(): CountedRecords {
  return countedRecords(() => Effect.succeed([recordAt('run-logs/r-1', 1), recordAt('notes/n2', 2)]));
}

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAt(`notes/n${read}`, read)]));
}

function parkedAlpha(hold: Hold): ParkedPlaybook {
  return { playbookKey, org, progress: { cursor: 'cursor-0', delivered: null, attempts: 0, waiting: false }, hold };
}

function passing(
  counted: CountedRecords,
  consumers: readonly RecordConsumer[] = [],
  passedEarly: PassParts['passedEarly'] = () => Effect.void,
) {
  return passingOn(() => ({ records: counted.records, consumers, calls: [], passedEarly }));
}

describe('a pass over the records of a playbook', () => {
  it('reads nothing of a playbook the follower does not follow', async () => {
    const counted = endlessNotes();
    const { pass } = await passing(counted);

    const end = await Effect.runPromise(pass(org, 'sweep'));

    expect([end, counted.reads()]).toEqual(['caught_up', []]);
  });

  it('passes over the records of a playbook parked in the org, delivering none of them, and moves the org past them', async () => {
    const delivered: string[] = [];
    const consumer = deliveringEach((id) => {
      delivered.push(id);
    });
    const { database, orgs, pass } = await passing(
      countedRecords(() => Effect.succeed([publishedAt(1)])),
      [consumer],
    );
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(insertedListener(database, listenerFor('com.acme.noted')));
    await Effect.runPromise(orgs.parked(parkedAlpha({ heldFor: 'content', since: 1, until: 2, holds: 1 })));

    const end = await Effect.runPromise(pass(org, 'signal'));
    const followed = await Effect.runPromise(orgs.load(org));

    expect([end, delivered, followed?.cursor]).toEqual(['more', [], 'cursor-1']);
  });

  it('reads 10 pages at most, without their data while nothing in the playbook reacts, keeps its place, and says there is more', async () => {
    const counted = endlessNotes();
    const { orgs, pass } = await passing(counted);
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));

    const end = await Effect.runPromise(pass(org, 'signal'));
    const followed = await Effect.runPromise(orgs.load(org));

    expect([end, counted.reads(), followed]).toEqual([
      'more',
      Array.from({ length: 10 }, () => false),
      { org, cursor: 'cursor-10', delivered: null, attempts: 0, waiting: true },
    ]);
  });
});

describe('a pass that delivers records and then fails', () => {
  it('keeps its place after each record it delivered, so the records delivered are not delivered again', async () => {
    const delivered: string[] = [];
    const consumer = deliveringEach((id) => {
      delivered.push(id);
    });
    const { database, orgs, pass } = await passing(publishedThenGone(), [consumer]);
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(insertedListener(database, listenerFor('com.acme.noted')));

    const exit = await Effect.runPromiseExit(pass(org, 'signal'));
    const followed = await Effect.runPromise(orgs.load(org));

    expect([Exit.isFailure(exit), delivered, followed?.cursor]).toEqual([true, ['record-1', 'record-2'], 'cursor-2']);
  });
});

describe('a pass that reads the data of a type in a stream that holds no events', () => {
  it('hands the record to no consumer and passes it over', async () => {
    const delivered: string[] = [];
    const misplaced = { ...publishedAt(1), stream: `${playbookKey}notes/n1` };
    const consumer = deliveringEach((id) => {
      delivered.push(id);
    });
    const { database, orgs, pass } = await passing(
      countedRecords(() => Effect.succeed([misplaced])),
      [consumer],
    );
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(insertedListener(database, listenerFor('com.acme.noted')));

    await Effect.runPromise(pass(org, 'signal'));
    const followed = await Effect.runPromise(orgs.load(org));

    expect([delivered, followed?.cursor]).toEqual([[], 'cursor-1']);
  });
});

describe('a pass that meets a record of a run held at every sweep', () => {
  it('parks the playbook at it, tries it again at each try of the parking, and passes it at the twentieth sweep, saying so', async () => {
    const early: string[] = [];
    const { orgs, pass, held } = await passing(undispatchedRun(), [], (key, record, sweeps) =>
      Effect.sync(() => {
        early.push(`${key} ${record.id} ${sweeps}`);
      }),
    );
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(pass(org, 'sweep'));

    const ends = await Effect.runPromise(
      Effect.forEach(Array.from({ length: 19 }), () =>
        Effect.flatMap(orgs.parkedForDelivery(8), (parked) => Effect.forEach(parked, (playbook) => held(playbook))),
      ),
    );

    expect(ends).toEqual(Array.from({ length: 19 }, () => ['waiting']));
    expect(early).toEqual([`${playbookKey} record-1 20`]);
  });
});

describe('a pass that meets a record of a run', () => {
  it('parks its playbook at it while the outputs of the record are not dispatched, tried at the next sweep and not by the clock, and goes on with the org', async () => {
    const counted = undispatchedRun();
    const { orgs, pass } = await passing(counted);
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));

    const end = await Effect.runPromise(pass(org, 'signal'));
    const followed = await Effect.runPromise(orgs.load(org));
    const due = await Effect.runPromise(orgs.parkedForDelivery(8));
    const byTheClock = await Effect.runPromise(orgs.heldAt(Number.MAX_SAFE_INTEGER, 8));

    expect([end, followed?.cursor, byTheClock.due]).toEqual(['more', 'cursor-2', []]);
    expect(due).toMatchObject([
      {
        playbookKey,
        org,
        progress: { cursor: 'cursor-1', delivered: null, attempts: 0 },
        hold: { heldFor: 'delivery', holds: 1 },
      },
    ]);
    expect(due[0]?.hold.until).toBe(due[0]?.hold.since);
  });
});

describe('a pass over a playbook parked in its org', () => {
  it('goes on from its place at most 10 pages at a time, then keeps its place with its hold lifted, due at once', async () => {
    const counted = endlessNotes();
    const { orgs, held } = await passing(counted);
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(orgs.save(org, { cursor: 'cursor-20', delivered: null, attempts: 0, waiting: false }));
    await Effect.runPromise(orgs.parked(parkedAlpha({ heldFor: 'content', since: 1, until: 2, holds: 1 })));
    const { due } = await Effect.runPromise(orgs.heldAt(Number.MAX_SAFE_INTEGER, 8));

    const ends = await Effect.runPromise(Effect.forEach(due, (parked) => held(parked)));
    const after = await Effect.runPromise(orgs.heldAt(Number.MAX_SAFE_INTEGER, 8));

    expect([ends, counted.reads().length]).toEqual([['more'], 10]);
    expect(after.due).toMatchObject([{ progress: { cursor: 'cursor-10' }, hold: { heldFor: 'content', holds: 0 } }]);
  });

  it('is lifted with nothing read when its org has no place to catch up to', async () => {
    const counted = endlessNotes();
    const { orgs, held } = await passing(counted);
    await Effect.runPromise(orgs.parked(parkedAlpha({ heldFor: 'content', since: 1, until: 2, holds: 1 })));
    const { due } = await Effect.runPromise(orgs.heldAt(Number.MAX_SAFE_INTEGER, 8));

    const unplaced = await Effect.runPromise(Effect.forEach(due, (parked) => held(parked)));
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(orgs.save(org, { cursor: null, delivered: null, attempts: 0, waiting: false }));
    await Effect.runPromise(orgs.parked(parkedAlpha({ heldFor: 'content', since: 1, until: 2, holds: 1 })));
    const atTheStart = await Effect.runPromise(
      Effect.flatMap(orgs.heldAt(Number.MAX_SAFE_INTEGER, 8), (again) =>
        Effect.forEach(again.due, (parked) => held(parked)),
      ),
    );

    expect([unplaced, atTheStart, counted.reads()]).toEqual([['caught_up'], ['caught_up'], []]);
    expect([...(await Effect.runPromise(orgs.heldIn(org)))]).toEqual([]);
  });
});

function deliveringWithoutEnd(): RecordConsumer {
  const made = { count: 0 };
  return {
    name: 'endless',
    skippedAfterSweeps: 20,
    batchOf: () =>
      Effect.sync(() => {
        made.count += 1;
        const key = String(made.count);
        return {
          deliveries: [{ key, workflow: 'note', deliver: Effect.void, skipped: () => Effect.void }],
          through: key,
          more: true,
        };
      }),
  };
}

describe('a pass over a parked playbook whose record has more deliveries than a pass makes', () => {
  it('stops at the record with its deliveries kept, its hold lifted and the playbook due again at once', async () => {
    const { database, orgs, held } = await passing(
      countedRecords(() => Effect.succeed([publishedAt(1)])),
      [deliveringWithoutEnd()],
    );
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(insertedListener(database, listenerFor('com.acme.noted')));
    await Effect.runPromise(orgs.parked(parkedAlpha({ heldFor: 'delivery', since: 1, until: 2, holds: 1 })));
    const due = await Effect.runPromise(orgs.parkedForDelivery(8));

    const ends = await Effect.runPromise(Effect.forEach(due, (parked) => held(parked)));
    const after = await Effect.runPromise(orgs.parkedForDelivery(8));

    expect(ends).toEqual(['more']);
    expect(after).toMatchObject([
      { progress: { cursor: 'cursor-0', delivered: '["endless","100"]' }, hold: { heldFor: 'delivery', holds: 0 } },
    ]);
  });
});
