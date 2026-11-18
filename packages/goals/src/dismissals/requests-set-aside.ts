import { dismissalsName } from '@on.auto/activity';
import { cutAtCodePoint } from '@on.auto/definitions';
import {
  PlaybookReader,
  type BoundProjectionReader,
  type PlaybookContext,
  type ProjectedKeyedRow,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { textOf } from '../assessments/assessment-state.ts';
import { mostDismissedByBytes } from '../reads/assessments-schema.ts';

const mostStandingDismissalsRead = 200;

export interface RequestSetAside {
  readonly goal: string;
  readonly id: string;
  readonly at: string;
  readonly by: string;
}

const StandingDismissalSchema = Schema.Struct({
  goal: Schema.String,
  at: Schema.Finite,
  by: Schema.String,
  requests: Schema.fromJsonString(Schema.Array(Schema.String)),
});

const standingDismissalOf = Schema.decodeUnknownOption(StandingDismissalSchema);

function setAsideBy({ key, row }: ProjectedKeyedRow): readonly (readonly [string, RequestSetAside])[] {
  return Option.toArray(standingDismissalOf(row)).flatMap(({ goal, at, by, requests }) => {
    const shown = { goal, id: key, at: textOf(at), by: cutAtCodePoint(by, mostDismissedByBytes) };
    return requests.map((request) => [request, shown] as const);
  });
}

export const requestsSetAsideBy = (
  read: BoundProjectionReader['readProjectedRows'],
): Effect.Effect<ReadonlyMap<string, RequestSetAside>> =>
  Effect.map(
    read(dismissalsName, {
      where: [{ column: 'dismissed', equals: true }],
      orderBy: ['at'],
      order: 'desc',
      limit: mostStandingDismissalsRead,
    }),
    (rows) => new Map(rows.flatMap((row) => setAsideBy(row)).toReversed()),
  );

export const requestsSetAside = (): Effect.Effect<
  ReadonlyMap<string, RequestSetAside>,
  never,
  PlaybookReader | PlaybookContext
> => Effect.flatMap(PlaybookReader, (reader) => requestsSetAsideBy(reader.readProjectedRows));
