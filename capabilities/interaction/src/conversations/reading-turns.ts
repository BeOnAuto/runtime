import { Clock, Effect } from 'effect';

import { replyWaitMsOf } from './cadence.ts';
import { advanced, cadenceOf, resting, type ConversationParts, type ConversationPlace } from './conversation-parts.ts';
import { readReplies, type ReadDone } from './conversation-reads.ts';
import type { Cadence } from './conversation-rows.ts';
import { openInConversation, readingOf, type OpenInConversation } from './open-in-conversation.ts';
import { cadenceAfter } from './read-cadence.ts';

interface ReadEnd {
  readonly floorMs: number;
  readonly now: number;
}

function cadenceAfterRead(
  place: ConversationPlace,
  { kept, more }: OpenInConversation,
  { state, answer }: ReadDone,
  { floorMs, now }: ReadEnd,
): Cadence {
  if (answer.outcome === 'not_sent') {
    return resting(place);
  }
  return cadenceAfter(place.row, {
    now,
    floorMs,
    open: more || kept.some(({ runId }) => !state.answered.has(runId)),
    foundAnswerer: state.foundAnswerer,
    retryAfterMs: answer.retryAfterMs,
  });
}

export function readNow(parts: ConversationParts, place: ConversationPlace, now: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const open = yield* openInConversation(parts, place);
    const [oldest] = open.kept;
    if (oldest === undefined) {
      return yield* advanced(parts, place, resting(place));
    }
    const route = readingOf(oldest);
    const floorMs = replyWaitMsOf(route.replies);
    const firstRead = place.row.active_at + floorMs;
    if (place.row.reads === 0 && now < firstRead) {
      return yield* advanced(parts, place, { ...cadenceOf(place), open: true, next_read_at: firstRead });
    }
    const read = yield* readReplies({ parts, place, route, kept: open.kept }, oldest);
    const end = { floorMs, now: yield* Clock.currentTimeMillis };
    return yield* advanced(parts, place, cadenceAfterRead(place, open, read, end));
  });
}
