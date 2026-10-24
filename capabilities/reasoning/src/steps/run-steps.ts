import type { RunAttempt } from '@on.auto/definitions';
import type { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import { resumedState } from './recorded-steps.ts';
import { stepped, type Stepped } from './step-loop.ts';
import type { Prompt } from './step-messages.ts';
import type { StepRun } from './step-run.ts';
import { firstState } from './step-state.ts';

export function answeredByTheSteps(
  run: StepRun,
  prompt: Prompt,
  { modelCallsBefore, calls }: RunAttempt,
): Effect.Effect<Stepped, Conflict> {
  return Effect.gen(function* () {
    const offered = new Map(run.tools.offered.map((tool) => [tool.name, tool]));
    const first = firstState(prompt, offered, modelCallsBefore);
    return yield* stepped(run, yield* resumedState(run.kept, first, calls));
  });
}
