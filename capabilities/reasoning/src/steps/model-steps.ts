import type { ModelCallFailedData } from '@on.auto/definitions';
import { Clock, Effect, Result } from 'effect';

import type { ModelCallJob, PerformJob } from '../jobs/jobs.ts';
import type { ModelResult } from '../model/model-result.ts';
import { notAnsweredBeforeItsAttemptEnded } from './attempt-facts.ts';
import { runBoundWords, type ModelCallNext } from './step-decision.ts';
import { answeredData, failedData, requestOf, sentText, type FailureOfACall } from './step-facts.ts';
import { responseOf, stepMessagesOf, type StepMessages } from './step-messages.ts';
import {
  keptOf,
  offeredOf,
  recordedOn,
  withinTheBound,
  type StepRecording,
  type StepRefusal,
  type StepRun,
} from './step-run.ts';
import { providerIn, type StepState } from './step-state.ts';

type Failure = Omit<ModelCallFailedData, 'duration_ms'>;

function failedCall(run: StepRecording, state: StepState, failure: Failure, durationMs: number) {
  const data = { number: state.facts.numbering.lastModelCall, ...failure, duration_ms: durationMs };
  return recordedOn(run, state, { type: 'model_call_failed', data }, {});
}

function interruptedCall(run: StepRecording, state: StepState, number: number): Effect.Effect<StepState, StepRefusal> {
  const provider = providerIn(state, run.model);
  const data = { number, because: 'interrupted' as const, provider, detail: notAnsweredBeforeItsAttemptEnded };
  return recordedOn(run, state, { type: 'model_call_failed', data: { ...data, duration_ms: 0 } }, {});
}

function scrubbedSent(sent: StepMessages, text: string, scrubbed: string): StepMessages {
  return scrubbed === text ? sent : stepMessagesOf(scrubbed);
}

function startedCall(run: StepRecording, state: StepState, { sent, final }: ModelCallNext) {
  const text = sentText(sent);
  return Effect.flatMap(keptOf(run, text), ({ text: scrubbed, kept: { bytes, sha256 } }) => {
    const data = {
      number: state.facts.numbering.lastModelCall + 1,
      model: run.model,
      messages_bytes: bytes,
      ...(sha256 === undefined ? {} : { messages_sha256: sha256 }),
      tools_offered: final ? 0 : run.tools.definitions.length,
    };
    return recordedOn(run, state, { type: 'model_call_started', data }, { sent: scrubbedSent(sent, text, scrubbed) });
  });
}

function answeredCall(
  run: StepRecording,
  state: StepState,
  result: ModelResult,
): Effect.Effect<StepState, StepRefusal> {
  return Effect.flatMap(keptOf(run, result.response), ({ text, kept }) => {
    const response = responseOf(text);
    const data = {
      number: state.facts.numbering.lastModelCall,
      ...answeredData({ result, response, kept }, offeredOf(run)),
    };
    return recordedOn(run, state, { type: 'model_call_answered', data }, { response });
  });
}

export interface BegunModelCall {
  readonly state: StepState;
  readonly job: ModelCallJob;
}

export type ModelCallSettled = { readonly answered: ModelResult } | { readonly failed: FailureOfACall };

export function settledOf(call: ReturnType<PerformJob['modelCall']>): Effect.Effect<ModelCallSettled> {
  return Effect.gen(function* () {
    const settled = yield* Effect.result(call);
    return Result.isFailure(settled) ? { failed: settled.failure } : { answered: settled.success };
  });
}

export function modelCallBegun(
  run: StepRecording,
  state: StepState,
  next: ModelCallNext,
): Effect.Effect<BegunModelCall, StepRefusal> {
  return Effect.gen(function* () {
    const ready = next.remade === null ? state : yield* interruptedCall(run, state, next.remade);
    const started = yield* startedCall(run, ready, next);
    return { state: started, job: { request: requestOf(run.base, started, next.final ? [] : run.tools.definitions) } };
  });
}

export function modelCallEnded(
  run: StepRecording,
  state: StepState,
  settled: ModelCallSettled,
  durationMs: number,
): Effect.Effect<StepState, StepRefusal> {
  return 'failed' in settled
    ? failedCall(run, state, failedData(settled.failed, providerIn(state, run.model)), durationMs)
    : answeredCall(run, state, settled.answered);
}

export function modelCallMade(
  run: StepRun,
  state: StepState,
  next: ModelCallNext,
): Effect.Effect<StepState, StepRefusal> {
  return Effect.gen(function* () {
    const { state: started, job } = yield* modelCallBegun(run, state, next);
    const began = yield* Clock.currentTimeMillis;
    const answer = yield* withinTheBound(run, settledOf(run.perform.modelCall(job)));
    const durationMs = (yield* Clock.currentTimeMillis) - began;
    if (Result.isFailure(answer)) {
      const detail = runBoundWords(answer.failure.runBoundMs);
      const provider = providerIn(started, run.model);
      return yield* failedCall(run, started, { because: 'cancelled', provider, detail }, durationMs);
    }
    return yield* modelCallEnded(run, started, answer.success, durationMs);
  });
}
