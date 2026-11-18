import {
  PlaybookReader,
  type PlaybookContext,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedValue,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { openRequestsName } from './open-requests.ts';

export interface DismissedShown {
  readonly dismissed?: 'include';
}

export interface RequestThing {
  readonly goal: string;
  readonly id: string;
  readonly per?: string;
}

export type RequestThings = (
  chains: readonly (readonly string[])[],
  shown: DismissedShown,
) => Effect.Effect<readonly (readonly RequestThing[])[], never, PlaybookReader | PlaybookContext>;

export interface RequestSetAside {
  readonly goal: string;
  readonly id: string;
  readonly at: string;
  readonly by: string;
}

export type RequestsSetAside = () => Effect.Effect<
  ReadonlyMap<string, RequestSetAside>,
  never,
  PlaybookReader | PlaybookContext
>;

export interface GoalsOfRequests {
  readonly about: RequestThings;
  readonly setAside: RequestsSetAside;
}

export const SetAsideSchema = Schema.Struct({
  goal: Schema.String.annotate({ description: 'The id of the goal of the dismissed thing' }),
  id: Schema.String.annotate({ description: 'The id of the dismissed thing' }),
  at: Schema.String.annotate({ description: 'When it was dismissed, in ISO 8601 UTC' }),
  by: Schema.String.annotate({ description: 'The id of the caller who dismissed it' }),
}).annotate({
  description:
    'The dismissed thing this request was waiting on when it was dismissed, by the goal and id dismiss_goal_thing takes to restore the thing; only a list asked with dismissed=include shows such a request',
});

export const DismissedInputFields = {
  dismissed: Schema.optionalKey(
    Schema.Literal('include').annotate({
      description:
        'include to also list the requests that were waiting on a thing when it was dismissed, each with dismissed naming the thing, and to show dismissed things in about. Left out, both are left out, so the list matches what Studio shows.',
    }),
  ),
};

const noneSetAside: ReadonlyMap<string, RequestSetAside> = new Map();

export function setAsideIn(
  setAside: RequestsSetAside | undefined,
): Effect.Effect<ReadonlyMap<string, RequestSetAside>, never, PlaybookReader | PlaybookContext> {
  return setAside === undefined ? Effect.succeed(noneSetAside) : setAside();
}

export function setAsideShown(setAside: RequestSetAside | undefined) {
  return setAside === undefined ? {} : { dismissed: setAside };
}

interface KeptPage {
  readonly where: readonly ProjectedCondition[];
  readonly after: readonly ProjectedValue[] | undefined;
  readonly limit: number;
  readonly leftOut: ReadonlyMap<string, unknown>;
}

function afterRow({ key, row }: ProjectedKeyedRow): readonly ProjectedValue[] {
  return [Number(row['requested_at']), key];
}

export function keptRowsOf({
  where,
  after,
  limit,
  leftOut,
}: KeptPage): Effect.Effect<readonly ProjectedKeyedRow[], never, PlaybookReader | PlaybookContext> {
  const size = limit + 1 + Math.min(leftOut.size, limit + 1);
  const readOn = (
    from: readonly ProjectedValue[] | undefined,
    kept: readonly ProjectedKeyedRow[],
  ): Effect.Effect<readonly ProjectedKeyedRow[], never, PlaybookReader | PlaybookContext> =>
    Effect.flatMap(
      Effect.flatMap(PlaybookReader, (reader) =>
        reader.readProjectedRows(openRequestsName, {
          where,
          orderBy: ['requested_at'],
          order: 'desc',
          ...(from === undefined ? {} : { after: from }),
          limit: size,
        }),
      ),
      (rows) => {
        const now = [...kept, ...rows.filter(({ key }) => !leftOut.has(key))];
        const last = rows.at(-1);
        return now.length > limit || rows.length < size || last === undefined
          ? Effect.succeed(now)
          : readOn(afterRow(last), now);
      },
    );
  return readOn(after, []);
}
