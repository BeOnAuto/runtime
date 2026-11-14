import type { RunAttempt } from '@on.auto/definitions';
import type { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import { resumedState } from './recorded-steps.ts';
import { stepped, type Stepped } from './step-loop.ts';
import type { Prompt } from './step-messages.ts';
import type { StepRecording, StepRun } from './step-run.ts';
import { firstState, withItsAdmission, type StepState } from './step-state.ts';

export function stateOfTheAttempt(
  run: StepRecording,
  prompt: Prompt,
  { modelCallsBefore, calls }: Pick<RunAttempt, 'modelCallsBefore' | 'calls'>,
): Effect.Effect<StepState> {
  const offered = new Map(run.tools.offered.map((tool) => [tool.name, tool]));
  const first = firstState(prompt, { offered, count: run.bounds.count }, modelCallsBefore);
  return Effect.map(resumedState(run.kept, first, calls), withItsAdmission);
}

export function answeredByTheSteps(
  run: StepRun,
  prompt: Prompt,
  attempt: RunAttempt,
): Effect.Effect<Stepped, Conflict> {
  return Effect.flatMap(stateOfTheAttempt(run, prompt, attempt), (state) => stepped(run, state));
}
