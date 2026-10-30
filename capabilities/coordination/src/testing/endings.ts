import { describeError, type Json, type RunOutcome } from '@on.auto/workflow-engine';

export type WorkflowEnding =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'failed'; readonly type: string; readonly message: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'broken'; readonly reason: string };

export function endingOf(outcome: RunOutcome): WorkflowEnding {
  if (outcome.kind === 'raised') {
    return { kind: 'failed', type: 'UncaughtError', message: describeError(outcome.error) };
  }
  if (outcome.kind === 'overran') {
    return {
      kind: 'failed',
      type: 'WorkflowRanTooLong',
      message: `The workflow ran for ${outcome.milliseconds} ms, the most it may run; it was stopped and its run ended cancelled`,
    };
  }
  if (outcome.kind === 'oversized') {
    return {
      kind: 'failed',
      type: 'WorkflowOutputTooLarge',
      message: `The workflow's output takes ${outcome.bytes} bytes as JSON, more than the ${outcome.most} a run records`,
    };
  }
  return outcome;
}
