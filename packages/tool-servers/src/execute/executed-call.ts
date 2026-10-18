import { DateTime, Effect, Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import type { CallReply } from '../calls/call-replies.ts';
import type { OfferedTool, RunTools } from '../calls/run-tools.ts';
import { ignored } from '../clients/ignored.ts';
import { notListed } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { CalledOutcomeSchema, type CalledOutcome } from './execute-schemas.ts';
import { executedAnswer } from './executed-answer.ts';

export interface HandCall {
  readonly reference: ToolReference;
  readonly callId: string;
  readonly input: Schema.JsonObject;
}

interface Calling {
  readonly calledAt: string;
  readonly answering: Promise<CallReply>;
  readonly replying: Promise<CallReply>;
  readonly stop: AbortController;
}

const isCalledOutcome = Schema.is(CalledOutcomeSchema);

function calledOutcomeOf({ outcome }: CallReply): Effect.Effect<CalledOutcome> {
  return isCalledOutcome(outcome)
    ? Effect.succeed(outcome)
    : Effect.die(new Error(`A call made by hand answered ${outcome}, which a call that was sent never answers`));
}

async function closedOnceAnswered(tools: RunTools, answering: Promise<CallReply>): Promise<CallReply> {
  try {
    return await answering;
  } finally {
    await tools.close();
  }
}

function startedCall(tools: RunTools, offered: OfferedTool, { callId, input }: HandCall, calledAt: string): Calling {
  const stop = new AbortController();
  const answering = offered.call(
    { callId, input, room: toolBounds.executedAnswerBytes },
    { signal: stop.signal, cancelled: stop.signal },
  );
  const replying = closedOnceAnswered(tools, answering);
  replying.catch(ignored);
  return { calledAt, answering, replying, stop };
}

function stopped({ stop, answering }: Calling): Effect.Effect<void> {
  return Effect.sync(() => {
    stop.abort();
  }).pipe(Effect.andThen(Effect.promise(() => answering)), Effect.asVoid);
}

export const offeredIn = Effect.fnUntraced(function* (tools: RunTools, called: HandCall) {
  const [offered] = tools.offered;
  if (offered === undefined) {
    yield* Effect.promise(() => tools.close());
    return yield* Effect.fail(notListed([called.reference]));
  }
  return offered;
});

const calledOn = Effect.fnUntraced(function* (tools: RunTools, offered: OfferedTool, called: HandCall) {
  const calledAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.sync(() => startedCall(tools, offered, called, calledAt));
});

type Restore = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

export const answeredOn = Effect.fnUntraced(function* (
  tools: RunTools,
  offered: OfferedTool,
  called: HandCall,
  restore: Restore,
) {
  const calling = yield* calledOn(tools, offered, called);
  const reply = yield* restore(Effect.promise(() => calling.replying)).pipe(Effect.onInterrupt(() => stopped(calling)));
  return {
    call_id: called.callId,
    server: called.reference.server,
    tool: called.reference.tool,
    outcome: yield* calledOutcomeOf(reply),
    text: reply.text,
    ...executedAnswer(reply),
    result_bytes: reply.resultBytes,
    duration_ms: reply.durationMs,
    ...(reply.serverRequestId === null ? {} : { server_request_id: reply.serverRequestId }),
    called_at: calling.calledAt,
  };
});
