import { Clock, Duration, Effect, Option } from 'effect';

import type { HeldName } from '../definition-names/name-judgement.ts';
import {
  streamPrefixOfPlaybook,
  streamPrefixOfTheDefinitionsOf,
  streamPrefixOfThePlaybooksOf,
} from '../ledger/bound-ports.ts';
import { playbookNamedFor } from '../ledger/names-held-now.ts';
import type { AppendedFactsReader } from '../ledger/stream-ports.ts';
import { CursorNotHeld } from '../reading/cursor-not-held.ts';
import { cursorOfParts, partsOfCursor, type CursorPart } from '../reading/cursor-parts.ts';
import {
  type AppendedFact,
  type AppendedFacts,
  type AppendedFactsRequest,
  type AppendedScope,
} from '../reading/recorded-read.ts';
import type { MemoryRecord } from './memory-recorded.ts';

export interface MemoryAppends {
  readonly reader: AppendedFactsReader;
  readonly appended: () => void;
}

const positionPattern = /^[1-9]\d{0,14}$/u;

export interface MemoryNames {
  readonly definitionsIn: (playbookKey: string) => readonly string[];
  readonly heldBy: (definitionKey: string) => HeldName | undefined;
}

function inScope(scope: AppendedScope, { definitionsIn }: MemoryNames): (record: MemoryRecord) => boolean {
  if (scope.kind === 'playbook') {
    const key = streamPrefixOfPlaybook(scope.playbook);
    const keys = [key, ...definitionsIn(key)];
    return ({ stream }) => keys.some((each) => stream.startsWith(each));
  }
  if (scope.kind === 'org') {
    const streams = new Set(scope.streams);
    const ofItsPlaybooks = [streamPrefixOfThePlaybooksOf(scope.org), streamPrefixOfTheDefinitionsOf(scope.org)];
    return ({ stream }) => streams.has(stream) || ofItsPlaybooks.some((prefix) => stream.startsWith(prefix));
  }
  const streams = new Set(scope.streams);
  const kinds = scope.streams.filter((named) => named.endsWith('/'));
  return ({ stream }) => streams.has(stream) || kinds.some((kind) => stream.startsWith(kind));
}

function cursorOf(record: MemoryRecord | undefined): string {
  return cursorOfParts(record === undefined ? [] : [String(record.position), record.id]);
}

function throughOf(position: number): string {
  return cursorOfParts([String(position)]);
}

function positionHeldBy(parts: readonly CursorPart[], scoped: readonly MemoryRecord[]): Option.Option<number> {
  if (parts.length === 0) {
    return Option.some(0);
  }
  const [position, id, ...rest] = parts;
  if (typeof position !== 'string' || !positionPattern.test(position) || rest.length > 0) {
    return Option.none();
  }
  const held = scoped.find((record) => record.position === Number(position));
  return held !== undefined && held.id === id ? Option.some(held.position) : Option.none();
}

function factOf({ dataOf }: AppendedFactsRequest, record: MemoryRecord): AppendedFact {
  return {
    cursor: cursorOf(record),
    id: record.id,
    stream: record.stream,
    type: record.type,
    context: record.context,
    data: dataOf.includes(record.type) ? record.data : undefined,
  };
}

function readFrom(
  scoped: readonly MemoryRecord[],
  request: AppendedFactsRequest,
  end: number,
): (position: number) => AppendedFacts {
  return (position) => {
    const after = scoped.filter((record) => record.position > position);
    const read = after.slice(0, request.most);
    const last = read.at(-1);
    const more = after.length > request.most;
    return {
      facts: read.map((record) => factOf(request, record)),
      cursor: last === undefined ? cursorOf(scoped.find((record) => record.position === position)) : cursorOf(last),
      through: more && last !== undefined ? throughOf(last.position) : throughOf(end),
      more,
    };
  };
}

function nowIn(scoped: readonly MemoryRecord[], end: number): AppendedFacts {
  return { facts: [], cursor: cursorOf(scoped.at(-1)), through: throughOf(end), more: false };
}

function positionThrough(through: string): number {
  const [position] = Option.getOrThrow(partsOfCursor(through));
  return Number(position);
}

function namedIn(scope: AppendedScope, { heldBy }: MemoryNames): (read: AppendedFacts) => AppendedFacts {
  return scope.kind === 'org'
    ? (read) => ({ ...read, facts: read.facts.map((fact) => playbookNamedFor(fact, heldBy)) })
    : (read) => read;
}

function factsIn(log: readonly MemoryRecord[], names: MemoryNames) {
  return (scope: AppendedScope, request: AppendedFactsRequest): Effect.Effect<AppendedFacts, CursorNotHeld> =>
    Effect.suspend(() => {
      const isInScope = inScope(scope, names);
      const scoped = log.filter((record) => isInScope(record));
      const end = log.length;
      if (request.after === undefined) {
        return Effect.succeed(nowIn(scoped, end));
      }
      const held = Option.flatMap(partsOfCursor(request.after), (parts) => positionHeldBy(parts, scoped));
      return Option.match(held, {
        onNone: () => Effect.fail(new CursorNotHeld()),
        onSome: (position) => Effect.succeed(namedIn(scope, names)(readFrom(scoped, request, end)(position))),
      });
    });
}

export function memoryAppendedReader(log: readonly MemoryRecord[], names: MemoryNames): MemoryAppends {
  const waiting = new Set<() => void>();
  const appendedAfter = (scope: AppendedScope, position: number): boolean => {
    const scoped = inScope(scope, names);
    return log.some((record) => record.position > position && scoped(record));
  };
  return {
    appended: () => {
      for (const wake of waiting) {
        wake();
      }
    },
    reader: {
      readAppendedFacts: factsIn(log, names),
      waitForAppend: (scope, after, deadline) =>
        Effect.gen(function* () {
          const left = deadline - (yield* Clock.currentTimeMillis);
          const position = positionThrough(after);
          const appended = Effect.callback<void>((resume) => {
            const wake = (): void => {
              if (appendedAfter(scope, position)) {
                waiting.delete(wake);
                resume(Effect.void);
              }
            };
            waiting.add(wake);
            wake();
            return Effect.sync(() => {
              waiting.delete(wake);
            });
          });
          const waited = yield* Effect.timeoutOption(appended, Duration.millis(Math.max(left, 0)));
          return Option.isSome(waited) ? 'appended' : 'ended';
        }),
    },
  };
}
