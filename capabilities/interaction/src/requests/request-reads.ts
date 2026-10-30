import { RequestAnsweredSchema, recordedAnswerOf, type RecordedAnswer } from '@on.auto/definitions';
import { PlaybookReader, type RecordedPageRequest } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { openRequestsName } from './open-requests.ts';
import { requestRowOf, type OpenRequestRow } from './request-rows.ts';

export function openRequestRowIn(id: string): Effect.Effect<OpenRequestRow | undefined, never, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    reader.readProjectedRows(openRequestsName, {
      where: [{ column: 'row_key', equals: id }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  ).pipe(Effect.map(([kept]) => requestRowOf(kept?.row)));
}

const decodeFirst = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ correlationId: Schema.String })));

export function correlationOfRun(id: string): Effect.Effect<string, never, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    reader.readRecorded({ kind: 'run', run: id }, { order: 'asc', limit: 1, dataOf: [] }),
  ).pipe(
    Effect.map(({ records }) => decodeFirst(records)[0].correlationId),
    Effect.orDie,
  );
}

export interface AnswerTaken extends RecordedAnswer {
  readonly id: string;
}

export const lastAnswerPage: RecordedPageRequest = {
  order: 'desc',
  limit: 1,
  types: ['request_answered'],
  dataOf: ['request_answered'],
};

const decodeAnswered = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(
    Schema.Struct({
      id: Schema.String,
      data: RequestAnsweredSchema,
      context: Schema.Struct({ by: Schema.String, at: Schema.String }),
    }),
  ),
);

export function answerTakenIn(records: unknown): AnswerTaken {
  const [{ id, ...fact }] = decodeAnswered(records);
  return { id, ...recordedAnswerOf(fact) };
}

export function answerTakenBy(id: string): Effect.Effect<AnswerTaken, never, PlaybookReader> {
  return PlaybookReader.use((reader) => reader.readRecorded({ kind: 'run', run: id }, lastAnswerPage)).pipe(
    Effect.map(({ records }) => answerTakenIn(records)),
    Effect.orDie,
  );
}
