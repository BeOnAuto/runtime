import {
  InvalidCursor,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type RecordedEvent,
  type RecordedFact,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type {
  DefinitionNamesStore,
  RecordedStore,
  StoredPage,
  StoredPageRequest,
  StoredRecord,
} from '../event-store.ts';
import type { OrgPageAsked, RecordedKeys } from '../keys/recorded-keys.ts';
import { cursorOf, pointOf, type CursorPoint } from './cursor.ts';

type PlaybookKeysStore = Pick<DefinitionNamesStore, 'definitionsIn'>;

async function keysOfThePlaybook(
  store: PlaybookKeysStore,
  playbook: PlaybookAddress,
  playbookKey: string,
): Promise<RecordedKeys> {
  return { org: playbook.org, keys: [playbookKey, ...(await store.definitionsIn(playbookKey))] };
}

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

export function recordedReaderOf(store: RecordedStore & PlaybookKeysStore): RecordedReader['readRecorded'] {
  return (playbook, selection, page) => {
    const playbookKey = streamPrefixOfPlaybook(playbook);
    return storedRequestOf(page, playbookKey, store.pointLength).pipe(
      Effect.flatMap((request) =>
        Effect.promise(async () =>
          store.readRecordedOfKeys(await keysOfThePlaybook(store, playbook, playbookKey), selection, request),
        ),
      ),
      Effect.map(recordedPageOf(playbookKey)),
    );
  };
}

export interface OrgPageRequest extends Omit<RecordedPageRequest, 'since'> {
  readonly through?: string;
}

function throughOf(
  through: string | undefined,
  org: string,
  pointLength: number,
): Effect.Effect<Pick<OrgPageAsked, 'to'>, InvalidCursor> {
  if (through === undefined) {
    return Effect.succeed({});
  }
  return Result.match(pointOf(through, org, pointLength), {
    onFailure: (kind) => Effect.fail(new InvalidCursor({ kind })),
    onSuccess: ({ point }: CursorPoint) => Effect.succeed({ to: point }),
  });
}

export function orgRecordedReaderOf(
  store: Pick<RecordedStore, 'readRecordedOfOrg' | 'pointLength'>,
): (org: string, page: OrgPageRequest) => Effect.Effect<RecordedPage, InvalidCursor> {
  return (org, { through, ...page }) =>
    Effect.gen(function* () {
      const request = yield* storedRequestOf(page, org, store.pointLength);
      const bound = yield* throughOf(through, org, store.pointLength);
      const stored = yield* Effect.promise(() => store.readRecordedOfOrg(org, { ...request, ...bound }));
      return recordedPageOf(org)(stored);
    });
}

export function recordedEventReaderOf(store: RecordedStore & PlaybookKeysStore): RecordedReader['readRecordedEvent'] {
  return (playbook, id) => {
    const playbookKey = streamPrefixOfPlaybook(playbook);
    return Effect.promise(async () =>
      store.readRecordedEventOfKeys(await keysOfThePlaybook(store, playbook, playbookKey), id),
    ).pipe(Effect.map((stored) => (stored === undefined ? undefined : recordedFactOf(stored))));
  };
}
