import { Clock, Duration, Effect, Option } from 'effect';

import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
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

function inScope(scope: AppendedScope): (record: MemoryRecord) => boolean {
  if (scope.kind === 'playbook') {
    const key = streamPrefixOfPlaybook(scope.playbook);
    return ({ stream }) => stream.startsWith(key);
  }
  const streams = new Set(scope.streams);
  return ({ stream }) => streams.has(stream);
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

export function memoryAppendedReader(log: readonly MemoryRecord[]): MemoryAppends {
  const waiting = new Set<() => void>();
  const appendedAfter = (scope: AppendedScope, position: number): boolean => {
    const scoped = inScope(scope);
    return log.some((record) => record.position > position && scoped(record));
  };
  return {
    appended: () => {
      for (const wake of waiting) {
        wake();
      }
    },
    reader: {
      readAppendedFacts: (scope, request) =>
        Effect.suspend(() => {
          const isInScope = inScope(scope);
          const scoped = log.filter((record) => isInScope(record));
          const end = log.length;
          if (request.after === undefined) {
            return Effect.succeed(nowIn(scoped, end));
          }
          const held = Option.flatMap(partsOfCursor(request.after), (parts) => positionHeldBy(parts, scoped));
          return Option.match(held, {
            onNone: () => Effect.fail(new CursorNotHeld()),
            onSome: (position) => Effect.succeed(readFrom(scoped, request, end)(position)),
          });
        }),
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
