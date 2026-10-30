import { Effect, Option } from 'effect';

import {
  InvalidCursor,
  boundedPage,
  mostExaminedInAPage,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type Context,
  type ExaminedPlace,
  type RecordedEvent,
  type RecordedFact,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
  type RecordedSelection,
} from '../index.ts';
import { cursorOfParts, partsOfCursor, type CursorPart } from '../reading/cursor-parts.ts';

export interface MemoryRecord {
  readonly position: number;
  readonly id: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly stream: string;
  readonly streamPosition: number;
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
  readonly recordedAt: string;
}

interface ExaminedRun {
  readonly examined: number;
  readonly wanted: boolean;
  readonly size: number;
  readonly position: number;
  readonly heads: readonly [MemoryRecord, ...MemoryRecord[]];
}

interface Resumed {
  readonly position: number;
  readonly inclusive: boolean;
}

type RunsSelection = Extract<RecordedSelection, { readonly kind: 'runs' }>;

const positionPattern = /^[1-9]\d{0,14}$/u;

const utf8 = new TextEncoder();

function playbookKeyOf(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments.length > 3 ? `${segments.slice(0, 3).join('/')}/` : undefined;
}

function isPositionPart(part: CursorPart | undefined): part is string {
  return typeof part === 'string' && positionPattern.test(part);
}

function resumedOf(key: string): (parts: readonly CursorPart[]) => Effect.Effect<Resumed, InvalidCursor> {
  return ([cursorKey, at, within, ...rest]) => {
    if (typeof cursorKey !== 'string' || !isPositionPart(at) || typeof within === 'string' || rest.length > 0) {
      return Effect.fail(new InvalidCursor({ kind: 'malformed' }));
    }
    return cursorKey === key
      ? Effect.succeed({ position: Number(at), inclusive: within !== undefined })
      : Effect.fail(new InvalidCursor({ kind: 'of_another_playbook' }));
  };
}

function resumedFrom({ cursor, order }: RecordedPageRequest, key: string): Effect.Effect<Resumed, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed({ position: order === 'asc' ? 0 : Number.POSITIVE_INFINITY, inclusive: false });
  }
  return Option.match(partsOfCursor(cursor), {
    onNone: () => Effect.fail(new InvalidCursor({ kind: 'malformed' })),
    onSome: resumedOf(key),
  });
}

function sizeOf({ data }: MemoryRecord): number {
  return utf8.encode(JSON.stringify(data)).byteLength;
}

function loads({ dataOf }: RecordedPageRequest, { type }: MemoryRecord): boolean {
  return dataOf === undefined || dataOf.includes(type);
}

function loadedSizeOf(page: RecordedPageRequest, record: MemoryRecord): number {
  return loads(page, record) ? sizeOf(record) : 0;
}

function inSelection(key: string, selection: RecordedSelection): (record: MemoryRecord) => boolean {
  if (selection.kind === 'run') {
    const streams = new Set([`${key}runs/${selection.run}`, `${key}run-logs/${selection.run}`]);
    return ({ stream }) => streams.has(stream);
  }
  if (selection.kind === 'runs') {
    const leftOut = new Set(selection.notBeginningWith);
    return ({ stream, streamPosition, type }) =>
      streamPosition === 1 && stream.startsWith(`${key}runs/`) && !leftOut.has(type);
  }
  return selection.kind === 'correlated' ? ({ correlationId }) => correlationId === selection.correlation : () => true;
}

function byTimeThenPosition(left: MemoryRecord, right: MemoryRecord): number {
  const apart = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
  return apart === 0 ? left.position - right.position : apart;
}

function firstSince(inPlaybook: readonly MemoryRecord[], since: string | undefined): number | undefined {
  if (since === undefined) {
    return 0;
  }
  const from = Date.parse(since);
  return inPlaybook
    .filter(({ recordedAt }) => Date.parse(recordedAt) >= from)
    .toSorted(byTimeThenPosition)
    .at(0)?.position;
}

function examinedRecords(
  candidates: readonly MemoryRecord[],
  page: RecordedPageRequest,
  examineAtMost: number,
): readonly ExaminedRun[] {
  return candidates.slice(0, examineAtMost + 1).map((record, index) => {
    const wanted = page.types === undefined || page.types.includes(record.type);
    return {
      examined: index + 1,
      wanted,
      size: wanted ? loadedSizeOf(page, record) : 0,
      position: record.position,
      heads: [record],
    };
  });
}

function holdsWhatWasAsked(asked: string | undefined, held: string | undefined): boolean {
  return asked === undefined || held === asked;
}

function isOfTheDefinitionAsked({ definitionType, name }: RunsSelection, { context }: MemoryRecord): boolean {
  return holdsWhatWasAsked(definitionType, context.definitionType) && holdsWhatWasAsked(name, context.definitionName);
}

function examinedRuns(
  log: readonly MemoryRecord[],
  candidates: readonly MemoryRecord[],
  page: RecordedPageRequest,
  selection: RunsSelection,
): readonly ExaminedRun[] {
  return candidates.slice(0, mostExaminedInAPage + 1).map((first, index) => {
    const latest = log.reduce((last, record) => (record.stream === first.stream ? record : last), first);
    const heads: ExaminedRun['heads'] = latest === first ? [first] : [first, latest];
    const wanted =
      (page.types === undefined || page.types.includes(latest.type)) && isOfTheDefinitionAsked(selection, first);
    const size = heads.reduce((total, head) => total + loadedSizeOf(page, head), 0);
    return { examined: index + 1, wanted, size: wanted ? size : 0, position: first.position, heads };
  });
}

function cursorAt(key: string, at: number): string {
  return cursorOfParts([key, String(at)]);
}

function recordedFactOf(record: MemoryRecord, loaded: boolean): RecordedFact {
  const { id, causationId, correlationId, stream, streamPosition: version, type, data, context, recordedAt } = record;
  return {
    id,
    causationId,
    correlationId,
    stream,
    version,
    globalPosition: record.position,
    type,
    data: loaded ? data : undefined,
    context,
    recordedAt,
  };
}

function recordedOf(key: string, record: MemoryRecord, loaded: boolean): RecordedEvent {
  return { ...recordedFactOf(record, loaded), cursor: cursorAt(key, record.position) };
}

function examinedPlaceOf(key: string, { position, heads: [first] }: ExaminedRun): ExaminedPlace {
  return { cursor: cursorAt(key, position), recordedAt: first.recordedAt };
}

function beyond({ position, inclusive }: Resumed, order: RecordedPageRequest['order']): (at: number) => boolean {
  if (order === 'asc') {
    return (at) => (inclusive ? at >= position : at > position);
  }
  return (at) => (inclusive ? at <= position : at < position);
}

function pageOf(
  log: readonly MemoryRecord[],
  key: string,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): (resumed: Resumed) => RecordedPage {
  return (resumed) => {
    const isBeyond = beyond(resumed, page.order);
    const inPlaybook = log.filter(({ stream }) => playbookKeyOf(stream) === key);
    const from = firstSince(inPlaybook, page.since) ?? Number.POSITIVE_INFINITY;
    const inOrder = page.order === 'asc' ? inPlaybook : inPlaybook.toReversed();
    const candidates = inOrder.filter(
      (record) => inSelection(key, selection)(record) && record.position >= from && isBeyond(record.position),
    );
    const cap = page.types === undefined && selection.kind !== 'runs' ? page.limit : mostExaminedInAPage;
    const examined =
      selection.kind === 'runs'
        ? examinedRuns(log, candidates, page, selection)
        : examinedRecords(candidates, page, cap);
    const { delivered, resumeAfter, lastExamined } = boundedPage(examined, page.limit, cap);
    const nextCursor = resumeAfter === undefined ? null : cursorAt(key, resumeAfter.position);
    return {
      records: delivered.flatMap(({ heads }) => heads.map((head) => recordedOf(key, head, loads(page, head)))),
      hasMore: nextCursor !== null,
      nextCursor,
      lastExamined: lastExamined === undefined ? null : examinedPlaceOf(key, lastExamined),
    };
  };
}

export function memoryRecordedReader(log: readonly MemoryRecord[]): RecordedReader {
  return {
    readRecorded: (playbook: PlaybookAddress, selection, page) =>
      Effect.suspend(() => {
        const key = streamPrefixOfPlaybook(playbook);
        return resumedFrom(page, key).pipe(Effect.map(pageOf(log, key, selection, page)));
      }),
    readRecordedEvent: (playbook, id) =>
      Effect.sync(() => {
        const key = streamPrefixOfPlaybook(playbook);
        const record = log.find((each) => each.id === id && playbookKeyOf(each.stream) === key);
        return record === undefined ? undefined : recordedFactOf(record, true);
      }),
  };
}
