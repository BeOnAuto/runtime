import { renderClock } from '@on.auto/definitions/template';
import { Clock, Effect } from 'effect';

import { readingsOfTheTurn, roomForACall } from '../readings/turn-readings.ts';
import { turnRead, type TurnDone } from '../readings/turn-reads.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { readFloorMsOf } from './cadence.ts';
import { advanced, cadenceOf, resting, type ConversationParts, type ConversationPlace } from './conversation-parts.ts';
import { isWoken, type Cadence } from './conversation-rows.ts';
import { openInConversation, type OpenInConversation } from './open-in-conversation.ts';
import { cadenceAfter } from './read-cadence.ts';

interface ReadEnd {
  readonly floorMs: number;
  readonly now: number;
}

function keepsTheTimer(place: ConversationPlace, done: TurnDone, open: boolean): boolean {
  return open && isWoken(place.row) && !done.state.foundAnswerer && done.retryAfterMs === null;
}

function cadenceAfterTurn(
  place: ConversationPlace,
  { kept, more }: OpenInConversation,
  done: TurnDone,
  { floorMs, now }: ReadEnd,
): Cadence {
  if (done.nothingSent) {
    return { ...resting(place), next_reading: done.nextReading };
  }
  const open = more || kept.some(({ runId }) => !done.state.answered.has(runId));
  if (keepsTheTimer(place, done, open)) {
    return { ...cadenceOf(place), open, next_reading: done.nextReading, waited_after: done.waitedAfter };
  }
  return cadenceAfter(place.row, {
    now,
    floorMs,
    open,
    foundAnswerer: done.state.foundAnswerer,
    retryAfterMs: done.retryAfterMs,
    waitedAfter: done.waitedAfter,
    nextReading: done.nextReading,
  });
}

export function readNow(parts: ConversationParts, place: ConversationPlace, now: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const open = yield* openInConversation(parts, place);
    const [oldest] = open.kept;
    if (oldest === undefined) {
      return yield* advanced(parts, place, resting(place));
    }
    const route = routeOfRequest(oldest);
    const floorMs = readFloorMsOf(route.replies, route.telling.readLimit);
    const firstRead = place.row.active_at + floorMs;
    if (place.row.reads === 0 && now < firstRead) {
      return yield* advanced(parts, place, { ...cadenceOf(place), open: true, next_read_at: firstRead });
    }
    const readings = readingsOfTheTurn(open.kept, place.row.conversation, yield* renderClock);
    const turn = { parts, place, candidates: open.kept, roomForACall: roomForACall(now) };
    const done = yield* turnRead(turn, readings, oldest);
    const end = { floorMs, now: yield* Clock.currentTimeMillis };
    return yield* advanced(parts, place, cadenceAfterTurn(place, open, done, end));
  });
}
