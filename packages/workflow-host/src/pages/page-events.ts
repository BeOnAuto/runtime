import { playbookEventOf, definitionTypeStreamOf, type CloudEvent } from '@on.auto/definitions';
import type { LedgerStreams, StoredPage, StoredPlace } from '@on.auto/ledger';

import type { Point } from './history-points.ts';

export interface PageEvent {
  readonly point: Point;
  readonly recordedAt: string;
  readonly record: string;
  readonly event: CloudEvent;
}

const recordsInAPage = 1000;

interface PassedOver {
  readonly record: string;
  readonly reason: 'unreadable';
}

export interface ReadPage {
  readonly events: readonly PageEvent[];
  readonly definitionsSeen: ReadonlySet<string>;
  readonly passedOver: readonly PassedOver[];
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

const definitionEvents = ['definition_created', 'definition_updated', 'definition_retired'];

const factTypes: ReadonlySet<string> = new Set([
  'run_started',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  ...definitionEvents,
]);

export function typesToRead(named: readonly string[]): readonly string[] {
  const published = named.some((type) => !factTypes.has(type)) ? ['event_published'] : [];
  const read = new Set([...named.filter((type) => factTypes.has(type)), ...published, ...definitionEvents]);
  return [...read].toSorted();
}

function eventOf(playbookKey: string, record: StoredRecord): CloudEvent | undefined {
  const { id, causationId, correlationId, version, globalPosition, type, data, metadata, recordedAt } = record;
  const stream = record.stream.slice(playbookKey.length);
  return playbookEventOf({
    id,
    causationId,
    correlationId,
    stream,
    version,
    globalPosition,
    type,
    data,
    context: metadata.context,
    recordedAt,
  });
}

function hasAMoment({ time }: CloudEvent): boolean {
  return time === undefined || Number.isFinite(Date.parse(time));
}

function placedOf(playbookKey: string, record: StoredRecord): PageEvent | PassedOver {
  const event = eventOf(playbookKey, record);
  return event === undefined || !hasAMoment(event)
    ? { record: record.id, reason: 'unreadable' }
    : { point: record.point, recordedAt: record.recordedAt, record: record.id, event };
}

function isPageEvent(placed: PageEvent | PassedOver): placed is PageEvent {
  return 'event' in placed;
}

function isPassedOver(placed: PageEvent | PassedOver): placed is PassedOver {
  return 'reason' in placed;
}

export async function readPage(
  store: LedgerStreams,
  { playbookKey, after, types, definitionTypes }: PageRead,
): Promise<ReadPage> {
  const page = await store.readRecorded(
    playbookKey,
    { kind: 'everything' },
    { order: 'asc', limit: recordsInAPage, types, ...(after === undefined ? {} : { after }) },
  );
  const placed = page.records.map((record) => placedOf(playbookKey, record));
  const streams = new Set(page.records.map(({ stream }) => stream));
  return {
    events: placed.filter((each) => isPageEvent(each)),
    definitionsSeen: new Set(
      definitionTypes.filter((type) => streams.has(`${playbookKey}${definitionTypeStreamOf(type)}`)),
    ),
    passedOver: placed.filter((each) => isPassedOver(each)),
    lastExamined: page.lastExamined,
    atTheEnd: page.resumeAfter === undefined,
  };
}
