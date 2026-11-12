import {
  definitionFactTypes,
  definitionTypeStreamOf,
  playbookEventBytesToRead,
  playbookEventOf,
  playbookEventRead,
  type CloudEvent,
} from '@on.auto/definitions';
import type { LedgerStreams, StoredPage, StoredPlace } from '@on.auto/ledger';
import type { PlaybookAddress, RecordedFact, Unavailable } from '@on.auto/operations';
import { payloadReaderOf, payloadReadsAtOnce, type PayloadReader } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { Point } from './history-points.ts';

export interface PageEvent {
  readonly point: Point;
  readonly recordedAt: string;
  readonly record: string;
  readonly event: CloudEvent;
}

const recordsInAPage = 1000;

export const pageReadBounds = { outputs: 100, bytes: 8 * 1_048_576 } as const;

export interface RecordAt {
  readonly record: string;
  readonly type: string;
  readonly point: Point;
}

interface PassedOver extends RecordAt {
  readonly reason: 'unreadable';
}

type ContentMissing = RecordAt;

export interface ReadPage {
  readonly events: readonly PageEvent[];
  readonly definitionsSeen: ReadonlySet<string>;
  readonly passedOver: readonly PassedOver[];
  readonly contentMissing: readonly ContentMissing[];
  readonly lastExamined: StoredPlace | undefined;
  readonly atTheEnd: boolean;
}

interface PageRead {
  readonly playbookKey: string;
  readonly after: Point | undefined;
  readonly types: readonly string[];
  readonly definitionTypes: readonly string[];
}

type StoredRecord = StoredPage['records'][number];

const savesOfPages: ReadonlySet<string> = new Set(['playbook_page_saved']);

const factTypes: ReadonlySet<string> = new Set([
  'run_started',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  ...definitionFactTypes,
]);

export function typesToRead(named: readonly string[]): readonly string[] {
  const published = named.some((type) => !factTypes.has(type)) ? ['event_published'] : [];
  const read = new Set([
    ...named.filter((type) => factTypes.has(type)),
    ...published,
    ...definitionFactTypes,
    ...savesOfPages,
  ]);
  return [...read].toSorted();
}

function factOf(playbookKey: string, record: StoredRecord): RecordedFact {
  const { id, causationId, correlationId, version, globalPosition, type, data, metadata, recordedAt } = record;
  return {
    id,
    causationId,
    correlationId,
    stream: record.stream.slice(playbookKey.length),
    version,
    globalPosition,
    type,
    data,
    context: metadata.context,
    recordedAt,
  };
}

interface EventOfAFact {
  readonly event: CloudEvent | undefined;
  readonly missing: boolean;
}

function eventRead(fact: RecordedFact, payloads: PayloadReader): Effect.Effect<EventOfAFact, Unavailable> {
  return playbookEventRead(fact, payloads).pipe(
    Effect.map((event): EventOfAFact => ({ event, missing: false })),
    Effect.catchTags({
      payload_missing: () => Effect.succeed<EventOfAFact>({ event: playbookEventOf(fact), missing: true }),
      payload_erased: () => Effect.succeed<EventOfAFact>({ event: playbookEventOf(fact), missing: false }),
    }),
  );
}

function hasAMoment({ time }: CloudEvent): boolean {
  return time === undefined || Number.isFinite(Date.parse(time));
}

interface Placed {
  readonly placed: PageEvent | PassedOver;
  readonly missing?: ContentMissing;
}

function placedRead(playbookKey: string, record: StoredRecord, payloads: PayloadReader) {
  return Effect.map(eventRead(factOf(playbookKey, record), payloads), ({ event, missing }): Placed => {
    const at: RecordAt = { record: record.id, type: record.type, point: record.point };
    const placed =
      event === undefined || !hasAMoment(event)
        ? { ...at, reason: 'unreadable' as const }
        : { point: record.point, recordedAt: record.recordedAt, record: record.id, event };
    return missing ? { placed, missing: at } : { placed };
  });
}

function isPageEvent(placed: PageEvent | PassedOver): placed is PageEvent {
  return 'event' in placed;
}

function isPassedOver(placed: PageEvent | PassedOver): placed is PassedOver {
  return 'reason' in placed;
}

interface Bounded {
  readonly records: readonly StoredRecord[];
  readonly cutAfter: StoredPlace | undefined;
}

function boundedByTheirReads(playbookKey: string, records: readonly StoredRecord[]): Bounded {
  let reads = 0;
  let bytes = 0;
  let examined: StoredPlace | undefined;
  for (const [index, record] of records.entries()) {
    const toRead = playbookEventBytesToRead(factOf(playbookKey, record));
    const counted = toRead > 0 ? 1 : 0;
    if (reads + counted > pageReadBounds.outputs || bytes + toRead > pageReadBounds.bytes) {
      return { records: records.slice(0, index), cutAfter: examined };
    }
    reads += counted;
    bytes += toRead;
    examined = { point: record.point, recordedAt: record.recordedAt };
  }
  return { records, cutAfter: undefined };
}

export function readPage(
  store: LedgerStreams,
  payloads: PayloadReader,
  { playbookKey, after, types, definitionTypes }: PageRead,
): Effect.Effect<ReadPage, Unavailable> {
  return Effect.gen(function* () {
    const page = yield* Effect.promise(() =>
      store.readRecorded(
        playbookKey,
        { kind: 'everything' },
        { order: 'asc', limit: recordsInAPage, types, ...(after === undefined ? {} : { after }) },
      ),
    );
    const bounded = boundedByTheirReads(playbookKey, page.records);
    const read = yield* Effect.forEach(
      bounded.records.filter(({ type }) => !savesOfPages.has(type)),
      (record) => placedRead(playbookKey, record, payloads),
      { concurrency: payloadReadsAtOnce },
    );
    const placed = read.map((each) => each.placed);
    const streams = new Set(bounded.records.map(({ stream }) => stream));
    const cut = bounded.records.length < page.records.length;
    return {
      events: placed.filter((each) => isPageEvent(each)),
      definitionsSeen: new Set(
        definitionTypes.filter((type) => streams.has(`${playbookKey}${definitionTypeStreamOf(type)}`)),
      ),
      passedOver: placed.filter((each) => isPassedOver(each)),
      contentMissing: read.flatMap(({ missing }) => (missing === undefined ? [] : [missing])),
      lastExamined: cut ? bounded.cutAfter : page.lastExamined,
      atTheEnd: !cut && page.resumeAfter === undefined,
    };
  });
}

export function readPageIn(
  { store, content }: Pick<HostDatabase, 'store' | 'content'>,
  { org, playbook }: PlaybookAddress,
  read: PageRead,
): Effect.Effect<ReadPage, Unavailable> {
  return readPage(store, payloadReaderOf({ owner: { org, playbook }, content }), read);
}
