import type { RecordedEvent, RecordedPage } from '@on.auto/operations';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { factPayloadsOn } from '../ledger-testing/ledger-connections.ts';
import { insertedListener, runPassedThrough } from '../listeners/listener-rows.ts';
import { definitionRecordsKeepingTheirOwnStops } from '../reaction-testing/own-stops.ts';
import {
  deliveringEach,
  finishedAt,
  finishesRead,
  lastPageOf,
  listenerFor,
  namesPlacingInAlpha,
  org,
  passingOn,
  placeOfTheTests,
  playbookKey,
  recordAt,
} from '../reaction-testing/playbook-passes.ts';
import { definitionKeyNamed, eventTrigger } from '../reaction-testing/playbook-writes.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import type { Consumer, FollowedRecord } from './consumers.ts';
import { followedOrgsOn } from './followed-orgs.ts';
import { passesOf, type PassParts } from './org-pass.ts';
import { stepOf, type StepParts, type Stepping } from './record-steps.ts';

interface Wanting {
  readonly consumer: Consumer;
  readonly delivered: readonly string[];
  readonly asked: readonly string[];
}

function wanting(name: string, wants?: boolean, wantedWith?: string): Wanting {
  const delivered: string[] = [];
  const asked: string[] = [];
  const noting = deliveringEach((id) => {
    delivered.push(`${name} ${id}`);
  });
  return {
    consumer: {
      ...noting,
      name,
      types: ['run_succeeded'],
      ...(wantedWith === undefined ? {} : { wantedWith }),
      ...(wants === undefined
        ? {}
        : {
            wants: (key: string) =>
              Effect.sync(() => {
                asked.push(key);
                return wants;
              }),
          }),
    },
    delivered,
    asked,
  };
}

async function passedOnce(...registered: readonly Consumer[]) {
  const reads: boolean[] = [];
  const database = await openedOn(await onSQLite());
  const orgs = followedOrgsOn(database);
  const { org: pass } = passesOf({
    database,
    orgs,
    names: database.store,
    records: {
      after: (_org, _cursor, delivers) =>
        Effect.sync(() => {
          reads.push(delivers.size > 0);
          return { records: [finishedAt(1)], hasMore: false, nextCursor: null, lastExamined: null };
        }),
    },
    consumers: [],
    registered,
    calls: [],
    definitionType: 'workflow',
    applyDefinitionRecord: Function.constant(Effect.succeed('applied')),
    unreadable: Function.constant(Effect.void),
    contentMissing: Function.constant(Effect.void),
    factPayloadsOf: factPayloadsOn(database),
    passedEarly: Function.constant(Effect.void),
    holdsUnreadable: false,
    now: Date.now,
    holdNotes: { tried: () => Effect.void, failed: () => Effect.void, lifted: () => Effect.void },
  });
  await Effect.runPromise(orgs.follow(org, placeOfTheTests));
  const end = await Effect.runPromise(pass(org, 'signal'));
  return { end, reads };
}

const playbookKeyPassData = 'playbook/acme/alpha/';

interface CountedRecords {
  readonly records: PassParts['records'];
  readonly reads: () => readonly boolean[];
}

function recordAtPassData(stream: string, position: number): RecordedEvent {
  return {
    id: `record-${position}`,
    cursor: `cursor-${position}`,
    causationId: null,
    correlationId: null,
    stream: `${playbookKeyPassData}${stream}`,
    version: 1,
    globalPosition: position,
    type: 'note_written',
    data: null,
    context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
}

function countedRecords(pageAt: (read: number) => Effect.Effect<readonly RecordedEvent[]>): CountedRecords {
  const reads: boolean[] = [];
  return {
    records: {
      after: (_org, _cursor, delivers) =>
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

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAtPassData(`notes/n${read}`, read)]));
}

function listening(database: HostDatabase, armedBy: number) {
  return insertedListener(database, {
    runKey: 'acme/alpha/r-1',
    listener: 'listener',
    playbookKey: playbookKeyPassData,
    streamId: `${playbookKeyPassData}run-logs/r-1`,
    armedBy,
    filters: '[{"type":"com.acme.noted"}]',
    workflow: 'wait',
    version: 1,
    passed: false,
  });
}

async function passing(counted: CountedRecords) {
  const opened = await openedOn(await onSQLite());
  const orgs = followedOrgsOn(opened);
  const { org: pass } = passesOf({
    database: opened,
    records: counted.records,
    orgs,
    names: opened.store,
    consumers: [],
    calls: [],
    definitionType: 'workflow',
    applyDefinitionRecord: () => Effect.succeed('applied'),
    unreadable: () => Effect.void,
    contentMissing: () => Effect.void,
    factPayloadsOf: factPayloadsOn(opened),
    passedEarly: () => Effect.void,
    registered: [],
    holdsUnreadable: false,
    now: Date.now,
    holdNotes: { tried: () => Effect.void, failed: () => Effect.void, lifted: () => Effect.void },
  });
  return { database: opened, orgs, pass };
}

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

async function passedOncePassReactions(opening: ReturnType<typeof passingOn>) {
  const { orgs, pass } = await opening;
  await Effect.runPromise(orgs.follow(org, placeOfTheTests));
  const end = await Effect.runPromise(pass(org, 'signal'));
  const followed = await Effect.runPromise(orgs.load(org));
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

const at = '2026-10-01T09:00:00.000Z';

function triggerActivatedAt(position: number): RecordedEvent {
  return {
    ...recordAt('definitions/workflow', position),
    stream: `${definitionKeyNamed('close')}definitions/workflow`,
    type: 'definition_created',
    data: {
      content: { source: 'schedule: {}', triggers: [eventTrigger({ type: 'run_succeeded' })] },
      created_by: { id: 'acme-admin', name: 'acme-admin' },
    },
    context: { at, by: 'acme-admin', definitionType: 'workflow', definitionName: 'close', definitionVersion: 1 },
  };
}

function notedAt(position: number, delivers: ReadonlySet<string>): RecordedEvent {
  const event = { specversion: '1.0', id: `e${position}`, source: '/acme', type: 'com.acme.noted', time: at };
  return {
    ...recordAt(`events/e${position}`, position),
    type: 'event_published',
    data: delivers.has('event_published') ? { event, filled: [] } : null,
  };
}

function pagesOf(pageAt: (read: number, delivers: ReadonlySet<string>) => Effect.Effect<RecordedPage>) {
  const reads = { count: 0 };
  const records: PassParts['records'] = {
    after: (_org, _cursor, delivers) =>
      Effect.suspend(() => {
        reads.count += 1;
        return pageAt(reads.count, delivers);
      }),
  };
  return records;
}

function pageOf(records: readonly RecordedEvent[], hasMore: boolean): RecordedPage {
  return { records, hasMore, nextCursor: null, lastExamined: null };
}

function namedWhileTheSecondPageIsRead(database: HostDatabase) {
  const named = Effect.orDie(insertedListener(database, listenerFor('com.acme.noted')));
  return pagesOf((read, delivers) => {
    if (read <= 2) {
      return Effect.succeed(pageOf([finishedAt(1)], true));
    }
    const page = Effect.succeed(pageOf([notedAt(2, delivers)], false));
    return read === 3 ? Effect.andThen(named, page) : page;
  });
}

async function passedTwice(over: Parameters<typeof passingOn>[0]) {
  const { orgs, pass } = await passingOn(over);
  await Effect.runPromise(orgs.follow(org, placeOfTheTests));
  const ends = [await Effect.runPromise(pass(org, 'signal')), await Effect.runPromise(pass(org, 'signal'))];
  return { ends, cursor: (await Effect.runPromise(orgs.load(org)))?.cursor };
}

describe('a consumer that says whether it wants the records of a playbook', () => {
  it('is asked once a pass, though the pass works out the types it wants as it begins and again at a record whose type was not named, and when it does not want them, is handed nothing and costs the pass no read of their data', async () => {
    const unwanted = wanting('assessor', false);

    const { end, reads } = await passedOnce(unwanted.consumer);

    expect([end, reads, unwanted.delivered, unwanted.asked]).toEqual(['caught_up', [false], [], [playbookKey]]);
  });

  it('is handed the records of its types when it wants them, read with their data', async () => {
    const wanted = wanting('assessor', true);

    const { reads } = await passedOnce(wanted.consumer);

    expect([reads, wanted.delivered, wanted.asked]).toEqual([[false, true], ['assessor record-1'], [playbookKey]]);
  });

  it('leaves the other consumers of the same types their records, as does a consumer that never says', async () => {
    const unwanted = wanting('assessor', false);
    const always = wanting('noting');

    const { reads } = await passedOnce(unwanted.consumer, always.consumer);

    expect([reads, unwanted.delivered, always.delivered]).toEqual([[false, true], [], ['noting record-1']]);
  });

  it('asks only the first of the consumers that want with the same answer, and hands the others that answer', async () => {
    const first = wanting('assessor', false, 'goal clocks');
    const second = wanting('notices seen', true, 'goal clocks');
    const own = wanting('own', true);

    const { reads } = await passedOnce(first.consumer, second.consumer, own.consumer);

    expect([reads, first.asked, second.asked, own.asked]).toEqual([[false, true], [playbookKey], [], [playbookKey]]);
    expect([first.delivered, second.delivered, own.delivered]).toEqual([[], [], ['own record-1']]);
  });
});

describe('a step over a record whose stepping has not worked out the consumers that want the playbook', () => {
  it('hands the record to every consumer given for its type', async () => {
    const always = wanting('noting');
    const stepping: Stepping = {
      playbookKey,
      gate: { verdictOn: () => Effect.succeed('passed') },
      mode: 'signal',
      delivered: () => new Set(['run_succeeded']),
      pageRead: Function.constVoid,
      readWithData: () => true,
      delivers: () => Effect.succeed(true),
      reactsTo: () => Effect.succeed(false),
      wantsMore: () => Effect.succeed(false),
      eventRead: ({ event }: FollowedRecord) => Effect.succeed({ event }),
    };
    const parts: StepParts = {
      consumers: [],
      registered: [always.consumer],
      calls: [],
      definitionType: 'workflow',
      applyDefinitionRecord: Function.constant(Effect.succeed('applied')),
      unreadable: Function.constant(Effect.void),
      contentMissing: Function.constant(Effect.void),
      passedEarly: Function.constant(Effect.void),
      holdsUnreadable: false,
    };

    await Effect.runPromise(
      stepOf(parts, stepping, { cursor: null, delivered: null, attempts: 0, waiting: false }, finishedAt(1)),
    );

    expect(always.delivered).toEqual(['noting record-1']);
  });
});

describe('the data of the records a pass reads', () => {
  it('is read again with it, after a glance without it, while a run of the playbook listens for a type of event', async () => {
    const counted = endlessNotes();
    const { database, orgs, pass } = await passing(counted);
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));
    await Effect.runPromise(Effect.orDie(listening(database, 7)));

    await Effect.runPromise(pass(org, 'signal'));

    expect(counted.reads().slice(0, 2)).toEqual([false, true]);
  });
});

describe('a pass over facts that another consumer reads, of a type no trigger or listener named as it began', () => {
  it('hands them to no consumer of the reactions while none names their type', async () => {
    const { delivered, opening } = finishedPassingOn(() => () => Effect.succeed([finishedAt(1), finishedAt(2)]));

    const passed = await passedOncePassReactions(opening);

    expect([passed, delivered]).toEqual([{ end: 'caught_up', cursor: 'cursor-2' }, []]);
  });

  it('hands the next of them to the consumers of the reactions once a listener made live by its own insert names their type', async () => {
    const { delivered, opening } = finishedPassingOn(listenedBeforeTheSecondRead);

    await passedOncePassReactions(opening);

    expect(delivered).toEqual(['record-1']);
  });

  it('hands the next of them to the consumers of the reactions once the pass made live a listener that names their type', async () => {
    const { delivered, opening } = finishedPassingOn(
      () => () => Effect.succeed([finishedAt(1), recordAt('run-logs/r-1', 2), finishedAt(3)]),
      armedWhileTheFirstIsRead,
    );

    await passedOncePassReactions(opening);

    expect(delivered).toEqual(['record-3']);
  });
});

describe('a pass that meets a definition activating a trigger of a type it reads already', () => {
  it('hands the next record of that type to the consumers of the reactions', async () => {
    const delivered: string[] = [];
    const { orgs, pass } = await passingOn((database) => ({
      records: lastPageOf(() => Effect.succeed([finishedAt(1), triggerActivatedAt(2), finishedAt(3)])),
      consumers: [
        deliveringEach((id) => {
          delivered.push(id);
        }),
      ],
      calls: [finishesRead()],
      passedEarly: () => Effect.void,
      applyDefinitionRecord: definitionRecordsKeepingTheirOwnStops(database),
      names: namesPlacingInAlpha(definitionKeyNamed('close')),
    }));
    await Effect.runPromise(orgs.follow(org, placeOfTheTests));

    await Effect.runPromise(pass(org, 'signal'));

    expect(delivered).toEqual(['record-3']);
  });
});

describe('a pass that meets an event of a type named after the page that holds it was read', () => {
  it('reads it again with its data rather than pass over it, and hands it to the consumers of the reactions', async () => {
    const delivered: string[] = [];

    const passed = await passedTwice((database) => ({
      records: namedWhileTheSecondPageIsRead(database),
      consumers: [
        deliveringEach((id) => {
          delivered.push(id);
        }),
      ],
      calls: [finishesRead()],
      passedEarly: () => Effect.void,
    }));

    expect([passed, delivered]).toEqual([{ ends: ['more', 'caught_up'], cursor: 'cursor-2' }, ['record-2']]);
  });
});
