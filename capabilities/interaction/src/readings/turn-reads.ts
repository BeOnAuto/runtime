import { Effect } from 'effect';

import { readReplies } from '../conversations/conversation-reads.ts';
import type { ReadAnswer } from '../conversations/read-answers.ts';
import type { ConversationTurn, ReadDone } from '../conversations/turn-parts.ts';
import { carriedOn, nothingTaken } from '../replies/reply-recording.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import { isLeading, leadingOf, sinceOf, type ReadingsOfAPlace } from './reading-cursors.ts';
import { readingsInTurn, type ReadingOfATurn } from './turn-readings.ts';

interface ReadsSoFar {
  readonly reads: readonly ReadAnswer[];
  readonly readThrough: number;
  readonly state: ReadDone['state'];
}

export interface TurnDone {
  readonly state: ReadDone['state'];
  readonly nothingSent: boolean;
  readonly retryAfterMs: number | null;
  readonly waitedAfter: string | null;
  readonly nextReading: number;
}

function waitOf(reads: readonly ReadAnswer[]): Pick<TurnDone, 'retryAfterMs' | 'waitedAfter'> {
  const asked = reads.find(({ retryAfterMs }) => retryAfterMs !== null);
  return { retryAfterMs: asked?.retryAfterMs ?? null, waitedAfter: asked?.failure ?? null };
}

function doneOf({ reads, state }: ReadsSoFar, everyReading: boolean, nextReading: number): TurnDone {
  return {
    state,
    nothingSent: everyReading && reads.every(({ outcome }) => outcome === 'not_sent'),
    ...waitOf(reads),
    nextReading,
  };
}

function withinTheHold(turn: ConversationTurn, { reads }: ReadsSoFar): Effect.Effect<boolean> {
  return reads.length === 0 ? Effect.succeed(true) : turn.roomForACall;
}

function readOn(
  turn: ConversationTurn,
  cursors: ReadingsOfAPlace,
  left: readonly ReadingOfATurn[],
  soFar: ReadsSoFar,
): Effect.Effect<ReadsSoFar> {
  const [next, ...rest] = left;
  if (next === undefined) {
    return Effect.succeed(soFar);
  }
  return Effect.gen(function* () {
    if (!(yield* withinTheHold(turn, soFar))) {
      return soFar;
    }
    const since = yield* sinceOf(cursors, next);
    const read = { reading: isLeading(cursors, next) ? undefined : next.reading, request: next.first, since };
    const done = yield* readReplies(turn, read, carriedOn(soFar.state));
    const askedToWait = done.answer.retryAfterMs !== null;
    const after = {
      reads: [...soFar.reads, done.answer],
      readThrough: soFar.readThrough + (askedToWait ? 0 : 1),
      state: done.state,
    };
    return askedToWait ? after : yield* readOn(turn, cursors, rest, after);
  });
}

export function turnRead(
  turn: ConversationTurn,
  readings: readonly ReadingOfATurn[],
  oldest: KeptRequest,
): Effect.Effect<TurnDone> {
  const { place } = turn;
  if (readings.length === 0) {
    const read = { reading: undefined, request: oldest, since: place.row.since };
    return Effect.map(readReplies(turn, read, nothingTaken), ({ answer, state }) =>
      doneOf({ reads: [answer], readThrough: 1, state }, true, place.row.next_reading),
    );
  }
  const cursors = { parts: turn.parts, place, leading: leadingOf(readings) };
  const chosen = readingsInTurn(readings, place.row.next_reading);
  return Effect.map(readOn(turn, cursors, chosen, { reads: [], readThrough: 0, state: nothingTaken }), (soFar) =>
    doneOf(
      soFar,
      soFar.readThrough === readings.length,
      (place.row.next_reading + soFar.readThrough) % readings.length,
    ),
  );
}
