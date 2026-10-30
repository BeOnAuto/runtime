import {
  InvalidCursor,
  streamPrefixOfPlaybook,
  type RecordedEvent,
  type RecordedFact,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { RecordedStore, StoredPage, StoredPageRequest, StoredRecord } from '../event-store.ts';
import { cursorOf, pointOf, type CursorPoint } from './cursor.ts';

function storedRequestOf(
  { cursor, ...page }: RecordedPageRequest,
  playbookKey: string,
  pointLength: number,
): Effect.Effect<StoredPageRequest, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed(page);
  }
  return Result.match(pointOf(cursor, playbookKey, pointLength), {
    onFailure: (kind) => Effect.fail(new InvalidCursor({ kind })),
    onSuccess: ({ point, within }: CursorPoint) =>
      Effect.succeed(within ? { ...page, at: point } : { ...page, after: point }),
  });
}

function recordedFactOf({
  id,
  causationId,
  correlationId,
  stream,
  version,
  globalPosition,
  type,
  data,
  metadata,
  recordedAt,
}: StoredRecord): RecordedFact {
  return {
    id,
    causationId,
    correlationId,
    stream,
    version,
    globalPosition,
    type,
    data,
    context: metadata.context,
    ...(metadata.traceId === undefined ? {} : { traceId: metadata.traceId }),
    ...(metadata.spanId === undefined ? {} : { spanId: metadata.spanId }),
    recordedAt,
  };
}

function recordedEventOf(playbookKey: string): (stored: StoredRecord) => RecordedEvent {
  return (stored) => ({ ...recordedFactOf(stored), cursor: cursorOf(playbookKey, stored.point) });
}

function recordedPageOf(playbookKey: string): (stored: StoredPage) => RecordedPage {
  const recorded = recordedEventOf(playbookKey);
  return ({ records, resumeAfter, lastExamined }) => ({
    records: records.map((record) => recorded(record)),
    hasMore: resumeAfter !== undefined,
    nextCursor: resumeAfter === undefined ? null : cursorOf(playbookKey, resumeAfter),
    lastExamined:
      lastExamined === undefined
        ? null
        : { cursor: cursorOf(playbookKey, lastExamined.point), recordedAt: lastExamined.recordedAt },
  });
}

export function recordedReaderOf(store: RecordedStore): RecordedReader['readRecorded'] {
  return (playbook, selection, page) => {
    const playbookKey = streamPrefixOfPlaybook(playbook);
    return storedRequestOf(page, playbookKey, store.pointLength).pipe(
      Effect.flatMap((request) => Effect.promise(() => store.readRecorded(playbookKey, selection, request))),
      Effect.map(recordedPageOf(playbookKey)),
    );
  };
}

export function recordedEventReaderOf(store: RecordedStore): RecordedReader['readRecordedEvent'] {
  return (playbook, id) => {
    const playbookKey = streamPrefixOfPlaybook(playbook);
    return Effect.promise(() => store.readRecordedEvent(playbookKey, id)).pipe(
      Effect.map((stored) => (stored === undefined ? undefined : recordedFactOf(stored))),
    );
  };
}
