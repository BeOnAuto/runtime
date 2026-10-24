import { randomBytes } from 'node:crypto';

import type { Conflict } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { modelCallMade } from './model-steps.ts';
import { nextStep, type NextStep } from './step-decision.ts';
import { interruptedOn, type CancelledEnding, type StepRecording, type StepRefusal, type StepRun } from './step-run.ts';
import { providerIn, type StepState } from './step-state.ts';
import { toolCallsMade } from './tool-steps.ts';

export type StepsEnding = Exclude<NextStep, { readonly type: 'model_call' | 'tool_calls' }> | CancelledEnding;

export interface Stepped {
  readonly state: StepState;
  readonly ending: StepsEnding;
}

export function decided(run: StepRecording, state: StepState): Effect.Effect<NextStep> {
  return Effect.map(Clock.currentTimeMillis, (now) =>
    nextStep(state, {
      bounds: run.bounds,
      elapsedMs: now - run.startedAt,
      fence: randomBytes(16).toString('hex'),
      provider: providerIn(state, run.model),
    }),
  );
}

function steppedOn(run: StepRun, from: StepState): Effect.Effect<Stepped, StepRefusal> {
  return Effect.gen(function* () {
    let state = from;
    let next = yield* decided(run, state);
    while (next.type === 'model_call' || next.type === 'tool_calls') {
      state =
        next.type === 'model_call' ? yield* modelCallMade(run, state, next) : yield* toolCallsMade(run, state, next);
      next = yield* decided(run, state);
    }
    return { state: yield* interruptedOn(run, state), ending: next };
  });
}

export function stepped(run: StepRun, from: StepState): Effect.Effect<Stepped, Conflict> {
  return Effect.catchTag(steppedOn(run, from), 'step_cancelled', ({ state, ending }: Stepped) =>
    Effect.succeed({ state, ending }),
  );
}
