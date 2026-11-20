import { dismissalsName } from '@on.auto/activity';
import { cutAtCodePoint } from '@on.auto/definitions';
import { goalType } from '@on.auto/definitions/goals';
import {
  PlaybookReader,
  addressOfTheRow,
  streamPrefixOfAddress,
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

interface NamedGoal {
  readonly definitionKey: string;
  readonly name: string;
}

export interface GoalRowsOfAPlaybook {
  readonly read: BoundProjectionReader['readProjectedRows'];
  readonly goalNames: Effect.Effect<readonly NamedGoal[]>;
}

const StandingDismissalSchema = Schema.Struct({
  at: Schema.Finite,
  by: Schema.String,
  requests: Schema.fromJsonString(Schema.Array(Schema.String)),
});

const standingDismissalOf = Schema.decodeUnknownOption(StandingDismissalSchema);

type GoalNames = ReadonlyMap<string, string>;

function setAsideBy(names: GoalNames, kept: ProjectedKeyedRow): readonly (readonly [string, RequestSetAside])[] {
  const goal = names.get(streamPrefixOfAddress(addressOfTheRow(kept)));
  if (goal === undefined) {
    return [];
  }
  return Option.toArray(standingDismissalOf(kept.row)).flatMap(({ at, by, requests }) => {
    const shown = { goal, id: kept.key, at: textOf(at), by: cutAtCodePoint(by, mostDismissedByBytes) };
    return requests.map((request) => [request, shown] as const);
  });
}

export const requestsSetAsideBy = ({
  read,
  goalNames,
}: GoalRowsOfAPlaybook): Effect.Effect<ReadonlyMap<string, RequestSetAside>> =>
  Effect.map(
    Effect.all([
      read(dismissalsName, {
        where: [{ column: 'dismissed', equals: true }],
        orderBy: ['at'],
        order: 'desc',
        limit: mostStandingDismissalsRead,
      }),
      goalNames,
    ]),
    ([rows, named]: readonly [readonly ProjectedKeyedRow[], readonly NamedGoal[]]) => {
      const names: GoalNames = new Map(named.map(({ definitionKey, name }) => [definitionKey, name]));
      return new Map(rows.flatMap((row) => setAsideBy(names, row)).toReversed());
    },
  );

export const requestsSetAside = (): Effect.Effect<
  ReadonlyMap<string, RequestSetAside>,
  never,
  PlaybookReader | PlaybookContext
> =>
  Effect.flatMap(PlaybookReader, (reader) =>
    requestsSetAsideBy({ read: reader.readProjectedRows, goalNames: reader.namesHeldIn(goalType) }),
  );
