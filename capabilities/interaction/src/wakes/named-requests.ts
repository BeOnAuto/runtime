import {
  playbookRowsOf,
  type PlaybookAddress,
  type PlaybookProjectedRow,
  type ProjectedKeyedRow,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { keptRequestOf, takesReplies } from '../conversations/open-in-conversation.ts';
import { repliesSeenBy, type SeenReplies } from '../facts/work-rules.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import { routeOfRequest, tellsTakenAndRefused } from '../replies/request-routes.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom } from '../requests/request-rows.ts';
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

function candidateOf(placed: PlaybookProjectedRow, connection: string): Candidate | undefined {
  const row = requestRowFrom(placed.row);
  if (row.conversation === null) {
    return undefined;
  }
  const request = keptRequestOf(placed, row);
  if (routeOfRequest(request).server !== connection) {
    return undefined;
  }
  if (row.open && takesReplies(row)) {
    return { request, answered: false };
  }
  return row.taken === null ? undefined : { request, answered: true };
}

const placedOf = (rows: readonly ProjectedKeyedRow[]): readonly PlaybookProjectedRow[] =>
  playbookRowsOf(openRequestsName, rows);

function candidateSentAs(
  parts: Pick<DeliveryParts, 'ledger'>,
  place: PlaceOfTheReplies,
  id: string,
): Effect.Effect<Candidate | undefined> {
  return Effect.map(rowSentAs(parts, place, id), (rows) => {
    const [placed] = placedOf(rows);
    return placed === undefined ? undefined : candidateOf(placed, place.connection);
  });
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
  return Effect.flatMap(candidateSentAs(parts, place, id), (candidate) =>
    candidate === undefined
      ? Effect.succeed([])
      : Effect.map(namedOf(parts, place.playbook, candidate), (named: NamedRequest) => [named]),
  );
}

interface RepliedTo {
  readonly id: string;
  readonly sender: string;
  readonly to: string;
}

interface AwaitedReply {
  readonly awaited: boolean;
  readonly typing: boolean;
}

export type ReplyAwaited = (place: PlaceOfTheReplies, reply: RepliedTo) => Effect.Effect<AwaitedReply>;

const notAwaited: AwaitedReply = { awaited: false, typing: false };

function typingFor(
  parts: Pick<DeliveryParts, 'ledger'>,
  playbook: PlaybookAddress,
  { request, answered }: Candidate,
  reply: RepliedTo,
): Effect.Effect<boolean> {
  if (answered || request.row.answerer !== reply.sender || !tellsTakenAndRefused(request)) {
    return Effect.succeed(false);
  }
  return Effect.map(repliesSeenBy(parts.ledger, { ...playbook, id: request.runId }), (seen) => !seen(reply.id));
}

export function replyAwaited(parts: Pick<DeliveryParts, 'ledger'>): ReplyAwaited {
  return (place, reply) =>
    Effect.flatMap(candidateSentAs(parts, place, reply.to), (candidate) =>
      candidate === undefined
        ? Effect.succeed(notAwaited)
        : Effect.map(typingFor(parts, place.playbook, candidate, reply), (typing) => ({ awaited: true, typing })),
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
