import { renderClock } from '@on.auto/definitions/template';
import { randomUUIDv7 } from '@on.auto/operations';
import { conversationCallIdKey } from '@on.auto/tool-servers/policy';
import { Clock, Effect, Result, type Schema } from 'effect';

import { readArgumentsOf, readRequestOf } from '../readings/request-readings.ts';
import { replyTaken, type Intake } from '../replies/reply-intake.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { cursorOf, listsFromTheFirstMessage, readAnswerOf, type ReadAnswer } from './read-answers.ts';
import { recordedRead, unsentRead } from './read-records.ts';
import type { ConversationTurn, OneRead, ReadDone } from './turn-parts.ts';

function recordable(answer: ReadAnswer, waitedAfter: string | null): boolean {
  if (answer.outcome === 'result') {
    return answer.considered > 0;
  }
  return answer.retryAfterMs === null || answer.failure !== waitedAfter;
}

const noMessages: ReadonlySet<string> = new Set();

function sentByThePlaybook(kept: ConversationTurn['candidates']): ReadonlySet<string> {
  return new Set(kept.map(({ sent }) => sent.id));
}

function sentRead(
  { parts, place, candidates, endedMessages, roomForACall, heldUntil }: ConversationTurn,
  read: OneRead,
  input: Readonly<Record<string, Schema.Json>>,
  carried: ReadDone['state'],
): Effect.Effect<ReadDone> {
  const route = routeOfRequest(read.request);
  const callId = randomUUIDv7();
  const reference = { server: route.server, tool: route.replies.tool };
  const call = { ...read.request.playbook, reference, input, meta: { [conversationCallIdKey]: callId } };
  const intake: Intake = {
    parts,
    candidates,
    arrival: { ...reference, conversation: read.request.sent.conversation, causationId: place.row.last_fact },
    roomForATelling: roomForACall,
    heldUntil,
  };
  return Effect.gen(function* () {
    const { fields: start, called: calling } = yield* parts.tools.preparedCall(call);
    const called = yield* calling;
    const fromTheFirstMessage = listsFromTheFirstMessage(route.replies, read);
    const passed = {
      sent: sentByThePlaybook(candidates),
      automatic: route.telling.automatic,
      fromTheFirstMessage,
      ended: fromTheFirstMessage ? yield* endedMessages : noMessages,
      readAt: yield* Clock.currentTimeMillis,
    };
    const answer = readAnswerOf(route.replies, called, passed);
    const state = yield* Effect.reduce(
      answer.replies,
      () => carried,
      (kept, reply) => replyTaken(intake, kept, reply),
    );
    if (recordable(answer, place.row.waited_after)) {
      const since = state.unrecorded ? read.since : cursorOf(route.replies.read.order, answer.ids, read.since);
      const told = answer.detail === undefined ? {} : { detail: answer.detail };
      const record = { start, called, answer, state, callId, reading: read.reading, since, ...told };
      yield* recordedRead(parts.ledger, { request: read.request, row: place.row }, record);
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
  const asked = readRequestOf(request, turn.place.row.conversation, turn.inputs);
  const route = routeOfRequest(request);
  const mostBytes = turn.parts.tools.mostRequestBytesTo(route.server);
  return Effect.flatMap(
    Effect.map(renderClock, (clock) => readArgumentsOf(route.replies, asked, since ?? '', { clock, mostBytes })),
    Result.match({
      onFailure: (failure) => unsentRead(turn, read, failure, carried),
      onSuccess: ({ input }) => sentRead(turn, read, input, carried),
    }),
  );
}
