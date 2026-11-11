import type { Issue, PlaybookAddress } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { saidOfARefusal, type ReplyRefusal, type ReplyRefused } from '../facts/run-facts.ts';
import { toldAnsweredAlready } from '../tellings/late-tellings.ts';
import { isPostedByThePlaybook } from '../tellings/own-messages.ts';
import { told, type Telling } from '../tellings/tellings.ts';
import { recordedReplyWork, type IntakeParts, type RecordedReply, type ReplyPlace } from './reply-recorder.ts';
import { refusalTellingOf, replyBoundsOfAReading, type IntakeState } from './reply-recording.ts';
import { decisionOf, type KeptRequest, type Reply, type ReplyDecision } from './reply-taking.ts';
import { routeOfRequest } from './request-routes.ts';

interface Arrival {
  readonly server: string;
  readonly tool: string;
  readonly conversation: string;
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

function answeredReplyOf(reply: Reply) {
  return { ...identityOf(reply), ...(reply.to === undefined ? {} : { to: reply.to }) };
}

interface Taking {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly answer: Schema.Json;
}

function taken(intake: Intake, state: IntakeState, { request, reply, answer }: Taking): Effect.Effect<IntakeState> {
  const work = { type: 'answer', answer: { answer, reply: answeredReplyOf(reply) } } as const;
  return recordedReplyWork(placeOf(intake), request, reply, { work }).pipe(
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

function tellingOf(intake: Intake, request: KeptRequest, call: Telling['call'], made: RecordedReply): Telling {
  return {
    playbook: intake.playbook,
    server: routeOfRequest(request).server,
    runId: request.runId,
    definition: {
      definitionType: 'interaction',
      definitionName: request.row.function,
      definitionVersion: request.row.version,
    },
    lineage: { causationId: made.id, correlationId: made.correlationId },
    conversation: request.sent.conversation,
    call,
  };
}

function refusedReply(intake: Intake, state: IntakeState, refusal: Refusal) {
  const { request, reply } = refusal;
  return Effect.gen(function* () {
    const open = intake.candidates.filter(({ runId }) => !state.answered.has(runId)).length;
    const input = yield* refusalTellingOf(intake.parts.ledger, intake.playbook, state, { ...refusal, open });
    if (input !== undefined && !(yield* intake.roomForATelling)) {
      return { ...state, foundAnswerer: true, unrecorded: true };
    }
    const fact = refusalFactOf(intake, refusal, input !== undefined);
    const work = { work: { type: 'work', fact }, refusal: refusal.because } as const;
    const made = yield* recordedReplyWork(placeOf(intake), request, reply, work).pipe(
      Effect.catchTag('unavailable', Effect.die),
    );
    if (made === undefined) {
      return state;
    }
    if (input !== undefined) {
      yield* told(intake.parts, tellingOf(intake, request, input, made));
    }
    const toldNow = (state.told.get(request.runId) ?? 0) + (input === undefined ? 0 : 1);
    const said = saidOfARefusal(refusal.because, refusal.issues);
    return {
      ...state,
      refused: state.refused + 1,
      foundAnswerer: true,
      told: new Map([...state.told, [request.runId, toldNow]]),
      lastSaid: input === undefined ? state.lastSaid : new Map([...state.lastSaid, [request.runId, said]]),
    };
  });
}

type Decided = Exclude<ReplyDecision, { readonly kind: 'nothing' }>;

function decided(intake: Intake, state: IntakeState, reply: Reply, decision: Decided): Effect.Effect<IntakeState> {
  if (decision.kind === 'take') {
    return taken(intake, state, { request: decision.request, reply, answer: decision.answer });
  }
  return refusedReply(intake, state, { ...decision, reply });
}

export function replyTaken(intake: Intake, state: IntakeState, reply: Reply): Effect.Effect<IntakeState> {
  const decision = decisionOf(reply, intake.candidates);
  if (state.unrecorded || decision.kind === 'nothing') {
    return Effect.succeed(state);
  }
  const { request } = decision;
  const posted = { conversation: intake.arrival.conversation, id: reply.id };
  const fromTheAnswerer = decision.kind === 'take' || decision.because !== 'not_the_answerer';
  const late = { ...intake, request, reply, causationId: intake.arrival.causationId };
  return Effect.flatMap(isPostedByThePlaybook(intake.parts.ledger, intake.playbook, posted), (own) => {
    if (own) {
      return Effect.succeed(state);
    }
    return fromTheAnswerer && state.answered.has(request.runId)
      ? Effect.as(toldAnsweredAlready(late, state), state)
      : decided(intake, state, reply, decision);
  });
}
