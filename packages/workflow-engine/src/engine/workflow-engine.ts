import type { Conflict } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { SubmissionOutcome } from '../machine/admission.ts';
import type { RunInput } from '../machine/run-input.ts';

export interface Submission {
  readonly outcome: SubmissionOutcome;
  readonly version: number;
  readonly declined?: string;
}

export interface Wake {
  readonly version: number;
  readonly dispatchedThrough: number;
}

export interface SweepReport {
  readonly runs: number;
  readonly timersArmedAgain: number;
}

export interface WorkflowEngine {
  readonly submit: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly wake: (runId: string) => Effect.Effect<Wake>;
  readonly sweep: (before: number) => Effect.Effect<SweepReport>;
}
