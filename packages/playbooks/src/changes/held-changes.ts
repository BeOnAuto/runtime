import {
  InvalidInput,
  type PlaybookReader,
  type AppendedFacts,
  type ChangeCatalog,
  type CursorNotHeld,
  type ChangedFact,
  type ResourceChange,
} from '@on.auto/operations';
import { Clock, Effect, Schema } from 'effect';

const mostChangesInAnAnswer = 200;

export const factsReadAtOnce = 1000;

const longestWaitSeconds = 25;

const longestCursor = 512;

export const ChangesInputSchema = Schema.Struct({
  since: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(longestCursor)).annotate({
      description: 'The cursor of the answer before; left out, the answer holds the cursor of now and no changes',
    }),
  ),
  wait: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: longestWaitSeconds })).annotate({
      description: `How many seconds, 0 to ${longestWaitSeconds}, the runtime holds the request while nothing changed; ${longestWaitSeconds} when left out`,
    }),
  ),
});

export type ChangesInput = typeof ChangesInputSchema.Type;

export function changesOutputSchemaOf({ kinds }: ChangeCatalog<ChangedFact>) {
  return Schema.Struct({
    cursor: Schema.String.annotate({ description: 'The cursor after the last change listed, to give back as since' }),
    changes: Schema.Array(Schema.Union(kinds.map(({ schema }) => schema))).annotate({
      description: `What changed, in the order the ledger recorded it, each resource once, at most ${mostChangesInAnAnswer}`,
    }),
    more: Schema.Boolean.annotate({ description: 'Whether more changed already, so the client asks again at once' }),
  });
}

export interface ChangesAnswer {
  readonly cursor: string;
  readonly changes: readonly ResourceChange[];
  readonly more: boolean;
}

export interface FollowedScope {
  readonly read: (after: string | undefined) => Effect.Effect<AppendedFacts, CursorNotHeld>;
  readonly waited: PlaybookReader['Service']['waitForAppend'];
  readonly readable: (change: ResourceChange) => boolean;
}

interface Asked {
  readonly since: string;
  readonly deadline: number;
}

function keyOf(change: ResourceChange): string {
  return JSON.stringify(
    Object.entries(change).toSorted(([left]: readonly [string, string], [right]: readonly [string, string]) =>
      left.localeCompare(right),
    ),
  );
}

function freshIn(
  changes: ReadonlyMap<string, ResourceChange>,
  named: readonly ResourceChange[],
): ReadonlyMap<string, ResourceChange> {
  const keyed = named.map((change) => [keyOf(change), change] as const);
  return new Map(keyed.filter(([key]) => !changes.has(key)));
}

function listedIn(catalog: ChangeCatalog<ChangedFact>, scope: FollowedScope, read: AppendedFacts, since: string) {
  const changes = new Map<string, ResourceChange>();
  const listed = { through: since };
  for (const fact of read.facts) {
    const fresh = freshIn(
      changes,
      catalog.changesOf(fact).filter((change) => scope.readable(change)),
    );
    if (changes.size + fresh.size > mostChangesInAnAnswer) {
      return { cursor: listed.through, changes: [...changes.values()], more: true };
    }
    for (const [key, change] of fresh) {
      changes.set(key, change);
    }
    listed.through = fact.cursor;
  }
  const cursor = changes.size === 0 && !read.more ? since : read.cursor;
  return { cursor, changes: [...changes.values()], more: read.more };
}

const cursorNotHeld = new InvalidInput({
  detail:
    'The cursor given as since is not one this server holds; ask again without since, which answers the cursor of now',
  issues: [{ pointer: '/since', detail: 'Expected the cursor of an answer of this server' }],
  kind: 'cursor_not_held',
});

function answeredBy(catalog: ChangeCatalog<ChangedFact>, scope: FollowedScope) {
  const answered = (read: AppendedFacts, asked: Asked): Effect.Effect<ChangesAnswer, CursorNotHeld> =>
    Effect.gen(function* () {
      const answer = listedIn(catalog, scope, read, asked.since);
      const now = yield* Clock.currentTimeMillis;
      if (answer.changes.length > 0 || answer.more || now >= asked.deadline) {
        return answer;
      }
      const waited = yield* scope.waited(read.through, asked.deadline);
      return waited === 'ended' ? answer : yield* answered(yield* scope.read(read.cursor), asked);
    });
  return answered;
}

export function heldChanges(catalog: ChangeCatalog<ChangedFact>, scope: FollowedScope) {
  const answered = answeredBy(catalog, scope);
  return ({ since, wait = longestWaitSeconds }: ChangesInput): Effect.Effect<ChangesAnswer, InvalidInput> =>
    Effect.gen(function* () {
      const read = yield* scope.read(since);
      if (since === undefined) {
        return { cursor: read.cursor, changes: [], more: false };
      }
      const deadline = (yield* Clock.currentTimeMillis) + wait * 1000;
      return yield* answered(read, { since, deadline });
    }).pipe(Effect.mapError(() => cursorNotHeld));
}
