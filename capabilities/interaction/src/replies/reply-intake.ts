import { renderClock } from '@on.auto/definitions/template';
import type { Issue, PlaybookAddress } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { ReplyRefusal, ReplyRefused } from '../facts/run-facts.ts';
import { recordedReplyWork, type IntakeParts, type RecordedReply, type ReplyPlace } from './reply-recorder.ts';
import { mayTell, replyBoundsOfAReading, tellingInput, type IntakeState } from './reply-recording.ts';
import { decisionOf, type KeptRequest, type Reply } from './reply-taking.ts';
import { routeOfRequest } from './request-routes.ts';
import { tellingWords } from './telling-words.ts';
import { told, type Telling } from './tellings.ts';

interface Arrival {
  readonly server: string;
  readonly tool: string;
  readonly causationId: string;
}

export interface Intake {
  readonly parts: IntakeParts;
  readonly playbook: PlaybookAddress;
  readonly candidates: readonly KeptRequest[];
  readonly arrival: Arrival;
  readonly roomForATelling: Effect.Effect<boolean>;
}

function placeOf({ parts, playbook, arrival }: Intake): ReplyPlace {
  return { parts, playbook, causationId: arrival.causationId };
}

function identityOf({ id, sender }: Reply) {
  return { id, sender };
}

interface Taking {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly answer: Schema.Json;
}

function taken(intake: Intake, state: IntakeState, { request, reply, answer }: Taking): Effect.Effect<IntakeState> {
  const work = { type: 'answer', answer: { answer, reply: identityOf(reply) } } as const;
  return recordedReplyWork(placeOf(intake), request, reply, work).pipe(
    Effect.map((made): IntakeState =>
      made === undefined
        ? state
        : {
            ...state,
            taken: state.taken + 1,
            foundAnswerer: true,
            answered: new Set([...state.answered, request.runId]),
          },
    ),
    Effect.catchTag('unavailable', () => Effect.succeed<IntakeState>({ ...state, unrecorded: true })),
  );
}

interface Refusal {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly because: ReplyRefusal;
  readonly issues: readonly Issue[];
}

function refusalFactOf({ arrival }: Intake, { reply, because, issues }: Refusal, telling: boolean): ReplyRefused {
  const kept = issues.slice(0, replyBoundsOfAReading.issues);
  return {
    type: 'reply_refused',
    data: {
      server: arrival.server,
      tool: arrival.tool,
      reply: identityOf(reply),
      because,
      ...(kept.length === 0 ? {} : { issues: kept }),
      told: telling,
    },
  };
}

function tellingOf(intake: Intake, request: KeptRequest, input: Telling['input'], made: RecordedReply): Telling {
  const route = routeOfRequest(request);
  return {
    playbook: intake.playbook,
    server: route.server,
    tool: route.replies.tell?.tool ?? route.delivering,
    runId: request.runId,
    definition: {
      definitionType: 'interaction',
      definitionName: request.row.function,
      definitionVersion: request.row.version,
    },
    input,
    lineage: { causationId: made.id, correlationId: made.correlationId },
  };
}

function tellingInputOf(state: IntakeState, { request, because, issues }: Refusal) {
  return Effect.map(renderClock, (clock) =>
    mayTell(state, request)
      ? tellingInput(routeOfRequest(request), request, tellingWords(request.rule, because, issues), clock)
      : undefined,
  );
}

function refusedReply(intake: Intake, state: IntakeState, refusal: Refusal) {
  const { request, reply } = refusal;
  return Effect.gen(function* () {
    const input = yield* tellingInputOf(state, refusal);
    if (input !== undefined && !(yield* intake.roomForATelling)) {
      return { ...state, foundAnswerer: true, unrecorded: true };
    }
    const fact = refusalFactOf(intake, refusal, input !== undefined);
    const made = yield* recordedReplyWork(placeOf(intake), request, reply, { type: 'work', fact }).pipe(
      Effect.catchTag('unavailable', Effect.die),
    );
    if (made === undefined) {
      return state;
    }
    if (input !== undefined) {
      yield* told(intake.parts, tellingOf(intake, request, input, made));
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

export function replyTaken(intake: Intake, state: IntakeState, reply: Reply): Effect.Effect<IntakeState> {
  const decision = decisionOf(reply, intake.candidates);
  if (state.unrecorded || decision.kind === 'nothing') {
    return Effect.succeed(state);
  }
  if (decision.kind === 'take') {
    return taken(intake, state, { request: decision.request, reply, answer: decision.answer });
  }
  return refusedReply(intake, state, { ...decision, reply });
}
