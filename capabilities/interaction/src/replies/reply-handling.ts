import { renderClock } from '@on.auto/definitions/template';
import type { Issue } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { ConversationParts, ConversationPlace, ReadingRoute } from '../conversations/conversation-parts.ts';
import type { ReplyRefusal, ReplyRefused } from '../facts/run-facts.ts';
import { recordedReplyWork } from './reply-recorder.ts';
import { mayTell, replyBoundsOfAReading, tellingInput, type ReadingState } from './reply-recording.ts';
import { decisionOf, type KeptRequest, type Reply } from './reply-taking.ts';
import { tellingWords } from './telling-words.ts';
import { told } from './tellings.ts';

export interface Reading {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
  readonly route: ReadingRoute;
  readonly kept: readonly KeptRequest[];
}

function identityOf({ id, sender }: Reply) {
  return { id, sender };
}

function readThrough({ route }: Reading) {
  return { server: route.server, tool: route.replies.tool };
}

interface Taking {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly answer: Schema.Json;
}

function taken(reading: Reading, state: ReadingState, { request, reply, answer }: Taking) {
  return Effect.gen(function* () {
    const made = yield* recordedReplyWork(reading, request, reply, {
      type: 'answer',
      answer: { answer, reply: identityOf(reply) },
    });
    if (made === undefined) {
      return state;
    }
    return {
      ...state,
      taken: state.taken + 1,
      foundAnswerer: true,
      answered: new Set([...state.answered, request.runId]),
    };
  });
}

interface Refusal {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly because: ReplyRefusal;
  readonly issues: readonly Issue[];
}

function refusedReply(reading: Reading, state: ReadingState, { request, reply, because, issues }: Refusal) {
  return Effect.gen(function* () {
    const clock = yield* renderClock;
    const input = mayTell(state, request)
      ? tellingInput(reading.route, request, tellingWords(request.rule, because, issues), clock)
      : undefined;
    const kept = issues.slice(0, replyBoundsOfAReading.issues);
    const fact: ReplyRefused = {
      type: 'reply_refused',
      data: {
        ...readThrough(reading),
        reply: identityOf(reply),
        because,
        ...(kept.length === 0 ? {} : { issues: kept }),
        told: input !== undefined,
      },
    };
    const made = yield* recordedReplyWork(reading, request, reply, { type: 'work', fact });
    if (made === undefined) {
      return state;
    }
    if (input !== undefined) {
      yield* told(reading.parts, {
        playbook: reading.place.playbook,
        server: reading.route.server,
        tool: reading.route.replies.tell?.tool ?? reading.route.delivering,
        runId: request.runId,
        definition: {
          definitionType: 'interaction',
          definitionName: request.row.function,
          definitionVersion: request.row.version,
        },
        input,
        lineage: { causationId: made.id, correlationId: made.correlationId },
      });
    }
    const toldNow = (state.told.get(request.runId) ?? 0) + (input === undefined ? 0 : 1);
    return {
      ...state,
      refused: state.refused + 1,
      foundAnswerer: true,
      told: new Map([...state.told, [request.runId, toldNow]]),
    };
  });
}

export function handledReply(reading: Reading, state: ReadingState, reply: Reply): Effect.Effect<ReadingState> {
  const decision = decisionOf(reply, reading.kept, state.answered);
  if (decision.kind === 'nothing') {
    return Effect.succeed(state);
  }
  if (decision.kind === 'take') {
    return taken(reading, state, { request: decision.request, reply, answer: decision.answer });
  }
  return refusedReply(reading, state, { ...decision, reply });
}
