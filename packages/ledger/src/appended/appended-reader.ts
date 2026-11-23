import {
  CursorNotHeld,
  cursorOfParts,
  definitionKeyOfStream,
  playbookNamedAsHeld,
  partsOfCursor,
  streamPrefixOfPlaybook,
  type AppendedFacts,
  type AppendedScope,
  type CursorPart,
  type Ledger,
} from '@on.auto/operations';
import { Clock, Duration, Effect, Option } from 'effect';

import type {
  AppendedFactsAsked,
  AppendWaitsStore,
  DefinitionNamesStore,
  FactPlace,
  FactScope,
  RecordedPoint,
  RecordedStore,
  StoredAppendedFacts,
} from '../event-store.ts';
import { isPosition } from '../recorded/cursor.ts';

type AppendedFactsPorts = Pick<Ledger['Service'], 'readAppendedFacts' | 'waitForAppend'>;

type AppendedStore = Pick<RecordedStore, 'pointLength' | 'readAppendedFacts'> &
  AppendWaitsStore &
  Pick<DefinitionNamesStore, 'definitionsIn' | 'nameHeldBy'>;

async function factScopeOf(store: AppendedStore, scope: AppendedScope): Promise<FactScope> {
  if (scope.kind === 'streams') {
    return scope;
  }
  if (scope.kind === 'org') {
    return { kind: 'org', org: scope.org.org, streams: scope.streams };
  }
  const playbookKey = streamPrefixOfPlaybook(scope.playbook);
  return { kind: 'playbook', playbookKey, definitionKeys: await store.definitionsIn(playbookKey) };
}

function cursorOf(place: FactPlace | null): string {
  return cursorOfParts(place === null ? [] : [...place.point, place.id]);
}

function placeOfParts(parts: readonly CursorPart[], pointLength: number): Option.Option<FactPlace | null> {
  if (parts.length === 0) {
    return Option.some(null);
  }
  const point = parts.slice(0, pointLength).filter((part) => isPosition(part));
  const [id, ...beyond] = parts.slice(pointLength);
  return point.length === pointLength && typeof id === 'string' && beyond.length === 0
    ? Option.some({ point, id })
    : Option.none();
}

function placeOf(cursor: string, pointLength: number): Option.Option<FactPlace | null> {
  return Option.flatMap(partsOfCursor(cursor), (parts) => placeOfParts(parts, pointLength));
}

function pointThrough(through: string, pointLength: number): RecordedPoint {
  const point = Option.getOrThrow(partsOfCursor(through)).filter((part) => isPosition(part));
  if (point.length !== pointLength) {
    throw new RangeError(`${through} is not a point through which the ledger was read`);
  }
  return point;
}

function appendedFactsOf(read: StoredAppendedFacts): Effect.Effect<AppendedFacts, CursorNotHeld> {
  if (!read.held) {
    return Effect.fail(new CursorNotHeld());
  }
  const { facts, last, through, more } = read;
  return Effect.succeed({
    facts: facts.map(({ point, id, stream, type, metadata, data }) => ({
      cursor: cursorOf({ point, id }),
      id,
      stream,
      type,
      context: metadata.context,
      data,
    })),
    cursor: cursorOf(last),
    through: cursorOfParts(through),
    more,
  });
}

function namedByTheirPlaybooks(store: AppendedStore): (read: AppendedFacts) => Effect.Effect<AppendedFacts> {
  return (read) =>
    Effect.promise(async () => {
      const keys = [...new Set(read.facts.flatMap(({ stream }) => definitionKeyOfStream(stream) ?? []))];
      const held = new Map(await Promise.all(keys.map(async (key) => [key, await store.nameHeldBy(key)] as const)));
      return {
        ...read,
        facts: read.facts.map((fact) => playbookNamedAsHeld(fact, held.get(definitionKeyOfStream(fact.stream) ?? ''))),
      };
    });
}

export function appendedFactsReaderOf(store: AppendedStore): AppendedFactsPorts {
  return {
    readAppendedFacts: (scope, { after, most, dataOf }) => {
      const named = scope.kind === 'org' ? namedByTheirPlaybooks(store) : Effect.succeed;
      const read = (asked: AppendedFactsAsked) =>
        Effect.promise(async () => store.readAppendedFacts(await factScopeOf(store, scope), asked)).pipe(
          Effect.flatMap(appendedFactsOf),
          Effect.flatMap(named),
        );
      if (after === undefined) {
        return read({ most, dataOf });
      }
      return Option.match(placeOf(after, store.pointLength), {
        onNone: () => Effect.fail(new CursorNotHeld()),
        onSome: (from) => read({ after: from, most, dataOf }),
      });
    },
    waitForAppend: (scope, after, deadline) =>
      Effect.gen(function* () {
        const point = yield* Effect.sync(() => pointThrough(after, store.pointLength));
        const left = deadline - (yield* Clock.currentTimeMillis);
        if (left <= 0) {
          return 'ended';
        }
        const appended = Effect.promise(async (signal) =>
          store.waitForAppend(await factScopeOf(store, scope), point, signal),
        );
        return Option.getOrElse(yield* Effect.timeoutOption(appended, Duration.millis(left)), () => 'ended' as const);
      }),
  };
}
