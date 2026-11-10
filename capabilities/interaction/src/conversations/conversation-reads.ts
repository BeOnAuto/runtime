import { renderClock } from '@on.auto/definitions/template';
import { randomUUIDv7 } from '@on.auto/operations';
import { conversationCallIdKey } from '@on.auto/tool-servers/policy';
import { Effect, Result, type Schema } from 'effect';

import { readArgumentsOf } from '../readings/request-readings.ts';
import { replyTaken, type Intake } from '../replies/reply-intake.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { cursorOf, readAnswerOf, type ReadAnswer } from './read-answers.ts';
import { recordedRead, unsentRead } from './read-records.ts';
import type { ConversationTurn, OneRead, ReadDone } from './turn-parts.ts';

function recordable(answer: ReadAnswer, waitedAfter: string | null): boolean {
  if (answer.outcome === 'result') {
    return answer.considered > 0;
  }
  return answer.retryAfterMs === null || answer.failure !== waitedAfter;
}

function sentByThePlaybook(kept: ConversationTurn['candidates']): ReadonlySet<string> {
  return new Set(kept.map(({ sent }) => sent.id));
}

function sentRead(
  { parts, place, candidates, roomForACall }: ConversationTurn,
  read: OneRead,
  input: Readonly<Record<string, Schema.Json>>,
  carried: ReadDone['state'],
): Effect.Effect<ReadDone> {
  const route = routeOfRequest(read.request);
  const callId = randomUUIDv7();
  const reference = { server: route.server, tool: route.replies.tool };
  const call = { ...place.playbook, reference, input, meta: { [conversationCallIdKey]: callId } };
  const intake: Intake = {
    parts,
    playbook: place.playbook,
    candidates,
    arrival: { ...reference, causationId: place.row.last_fact },
    roomForATelling: roomForACall,
  };
  return Effect.gen(function* () {
    const { fields: start, called: calling } = yield* parts.tools.preparedCall(call);
    const called = yield* calling;
    const answer = readAnswerOf(route.replies, called, sentByThePlaybook(candidates));
    const state = yield* Effect.reduce(
      answer.replies,
      () => carried,
      (kept, reply) => replyTaken(intake, kept, reply),
    );
    if (recordable(answer, place.row.waited_after)) {
      const since = state.unrecorded ? read.since : cursorOf(route.replies.read.order, answer.ids, read.since);
      yield* recordedRead(parts.ledger, place, { start, called, answer, state, callId, reading: read.reading, since });
    }
    return { answer, state };
  });
}

export function readReplies(
  turn: ConversationTurn,
  read: OneRead,
  carried: ReadDone['state'],
): Effect.Effect<ReadDone> {
  const { request, since } = read;
  const asked = { to: request.row.party, sent: request.sent, key: turn.place.row.conversation };
  return Effect.flatMap(
    Effect.map(renderClock, (clock) => readArgumentsOf(routeOfRequest(request).replies, asked, since ?? '', clock)),
    Result.match({
      onFailure: (failure) => unsentRead(turn, read, failure, carried),
      onSuccess: ({ input }) => sentRead(turn, read, input, carried),
    }),
  );
}
