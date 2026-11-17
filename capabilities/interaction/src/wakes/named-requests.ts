import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { keptRequestOf, takesReplies } from '../conversations/open-in-conversation.ts';
import { repliesSeenBy, type SeenReplies } from '../facts/work-rules.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom, type OpenRequestRow } from '../requests/request-rows.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { answerToldKnowingly } from '../tellings/own-messages.ts';

export interface PlaceOfTheReplies {
  readonly playbook: PlaybookAddress;
  readonly connection: string;
  readonly conversation: string;
}

export interface NamedRequest {
  readonly request: KeptRequest;
  readonly answered: boolean;
  readonly answeredAndTold: boolean;
  readonly seen: SeenReplies;
}

interface Candidate {
  readonly request: KeptRequest;
  readonly answered: boolean;
}

function rowSentAs(parts: Pick<DeliveryParts, 'ledger'>, { playbook, conversation }: PlaceOfTheReplies, id: string) {
  return parts.ledger.readProjectedRows(openRequestsName, playbook, {
    where: [
      { column: 'sent_conversation', equals: conversation },
      { column: 'sent_id', equals: id },
    ],
    orderBy: [],
    order: 'asc',
    limit: 1,
  });
}

function candidateOf(runId: string, row: OpenRequestRow, connection: string): Candidate | undefined {
  if (row.conversation === null) {
    return undefined;
  }
  const request = keptRequestOf(runId, row);
  if (routeOfRequest(request).server !== connection) {
    return undefined;
  }
  if (row.open && takesReplies(row)) {
    return { request, answered: false };
  }
  return row.taken === null ? undefined : { request, answered: true };
}

function namedOf(
  parts: DeliveryParts,
  playbook: PlaybookAddress,
  { request, answered }: Candidate,
): Effect.Effect<NamedRequest> {
  return Effect.gen(function* () {
    const seen = yield* repliesSeenBy(parts.ledger, { ...playbook, id: request.runId });
    const told = answered && (yield* answerToldKnowingly(parts.ledger, playbook, request));
    return { request, answered, answeredAndTold: told, seen };
  });
}

function namedBy(parts: DeliveryParts, place: PlaceOfTheReplies, id: string): Effect.Effect<readonly NamedRequest[]> {
  return Effect.flatMap(rowSentAs(parts, place, id), ([kept]) => {
    const candidate =
      kept === undefined ? undefined : candidateOf(kept.key, requestRowFrom(kept.row), place.connection);
    return candidate === undefined
      ? Effect.succeed([])
      : Effect.map(namedOf(parts, place.playbook, candidate), (named: NamedRequest) => [named]);
  });
}

export type ReplyAwaited = (place: PlaceOfTheReplies, to: string) => Effect.Effect<boolean>;

export function replyAwaited(parts: Pick<DeliveryParts, 'ledger'>): ReplyAwaited {
  return (place, to) =>
    Effect.map(
      rowSentAs(parts, place, to),
      ([kept]) => kept !== undefined && candidateOf(kept.key, requestRowFrom(kept.row), place.connection) !== undefined,
    );
}

export function requestsNamed(
  parts: DeliveryParts,
  place: PlaceOfTheReplies,
  ids: readonly string[],
): Effect.Effect<readonly NamedRequest[]> {
  return Effect.map(
    Effect.forEach([...new Set(ids)], (id) => namedBy(parts, place, id)),
    (named: readonly (readonly NamedRequest[])[]) => named.flat(),
  );
}
