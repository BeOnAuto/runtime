import type { Conflict } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { ModelCallJob, PerformJob, ToolCallAnswer, ToolCallJob } from '../jobs/jobs.ts';
import { modelCallBegun, modelCallEnded, settledOf, type ModelCallSettled } from './model-steps.ts';
import type { ToolCallsNext } from './step-decision.ts';
import { decided, type StepsEnding } from './step-loop.ts';
import { interruptedOn, type StepCancelled, type StepRecording, type StepRefusal } from './step-run.ts';
import type { StepState } from './step-state.ts';
import { toolCallBegun, toolCallEnded } from './tool-steps.ts';

export type StepJob =
  | { readonly type: 'model_call'; readonly job: ModelCallJob }
  | { readonly type: 'tool_call'; readonly number: number; readonly job: ToolCallJob };

export type JobAnswer =
  | { readonly type: 'model_call'; readonly settled: ModelCallSettled; readonly durationMs: number }
  | { readonly type: 'tool_call'; readonly number: number; readonly answer: ToolCallAnswer };

export interface StepJobs {
  readonly state: StepState;
  readonly jobs: readonly StepJob[];
  readonly ending: StepsEnding | null;
}

function endedOn(run: StepRecording, state: StepState, ending: StepsEnding): Effect.Effect<StepJobs, StepRefusal> {
  return Effect.map(interruptedOn(run, state), (after) => ({ state: after, jobs: [], ending }));
}

function toolJobsOf(run: StepRecording, state: StepState, { calls, room }: ToolCallsNext) {
  return Effect.flatMap(interruptedOn(run, state), (open) =>
    Effect.reduce(
      calls,
      (): StepJobs => ({ state: open, jobs: [], ending: null }),
      (begun, call) =>
        Effect.map(toolCallBegun(run, begun.state, call, room), ({ state: after, number, job }) => ({
          ...begun,
          state: after,
          jobs: [...begun.jobs, { type: 'tool_call' as const, number, job }],
        })),
    ),
  );
}

function cancelledInto(effect: Effect.Effect<StepJobs, StepRefusal>): Effect.Effect<StepJobs, Conflict> {
  return Effect.catchTag(effect, 'step_cancelled', ({ state, ending }: Pick<StepCancelled, 'state' | 'ending'>) =>
    Effect.succeed({ state, jobs: [], ending }),
  );
}

export function jobsOf(run: StepRecording, state: StepState): Effect.Effect<StepJobs, Conflict> {
  return cancelledInto(
    Effect.flatMap(decided(run, state), (next) => {
      if (next.type === 'model_call') {
        return Effect.map(modelCallBegun(run, state, next), ({ state: after, job }) => ({
          state: after,
          jobs: [{ type: 'model_call' as const, job }],
          ending: null,
        }));
      }
      return next.type === 'tool_calls' ? toolJobsOf(run, state, next) : endedOn(run, state, next);
    }),
  );
}

export function performedJob(perform: PerformJob, step: StepJob): Effect.Effect<JobAnswer> {
  if (step.type === 'tool_call') {
    return Effect.map(perform.toolCall(step.job), (answer) => ({ type: 'tool_call', number: step.number, answer }));
  }
  return Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    const settled = yield* settledOf(perform.modelCall(step.job));
    return { type: 'model_call', settled, durationMs: (yield* Clock.currentTimeMillis) - began };
  });
}

export function answerRecorded(
  run: StepRecording,
  state: StepState,
  answer: JobAnswer,
): Effect.Effect<StepJobs, Conflict> {
  const recorded =
    answer.type === 'model_call'
      ? modelCallEnded(run, state, answer.settled, answer.durationMs)
      : toolCallEnded(run, state, answer.number, answer.answer);
  return cancelledInto(Effect.map(recorded, (after): StepJobs => ({ state: after, jobs: [], ending: null })));
}
