import type { ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { attemptInFlightMs } from '../requests/open-requests.ts';
import type { DueRequestItem, RequestsDue } from '../schedule/due-requests.ts';
import { advanced, cadenceOf, type ConversationParts, type ConversationPlace } from './conversation-parts.ts';
import { conversationRowFrom, conversationsName } from './conversation-rows.ts';
import { readNow } from './reading-turns.ts';

function conversationRead(parts: ConversationParts, place: ConversationPlace, now: number): Effect.Effect<void> {
  return Effect.andThen(
    advanced(parts, place, { ...cadenceOf(place), open: true, next_read_at: now + attemptInFlightMs }),
    readNow(parts, place, now),
  );
}

function itemOf(parts: ConversationParts, kept: ProjectedKeyedRow): DueRequestItem {
  const place = {
    playbook: { org: kept.org, playbook: kept.playbook },
    key: kept.key,
    row: conversationRowFrom(kept.row),
  };
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}`,
    callsOut: true,
    perform: (now) => Effect.suspend(() => conversationRead(parts, place, now)),
  };
}

const callsNothing: readonly DueRequestItem[] = [];

export function conversationsDue(parts: ConversationParts): RequestsDue {
  return {
    name: 'the conversations whose replies the playbook reads',
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.map(
            parts.ledger.readDueRows(conversationsName, { column: 'due_at', through: now, limit: most }),
            (rows) => rows.map((kept) => itemOf(parts, kept)),
          )
        : Effect.succeed(callsNothing),
    nextDueAt: (after, callsOut = true) =>
      callsOut ? parts.ledger.nextDueOf(conversationsName, 'due_at', after) : Effect.succeed(null),
  };
}
