import type { RunEnding } from '@on.auto/definitions';
import type { Outcome, Rejected } from '@on.auto/operations';
import { field, textField } from '@on.auto/workflow-engine';

import type { DefinitionRunResult, EndedRunResult } from './function-run.ts';

function whereAndWhenOf({ resolve_at: resolveAt, lifts_at: liftsAt, limited_because: limitedBecause }: Rejected) {
  return {
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
    ...(liftsAt === undefined ? {} : { lifts_at: liftsAt }),
    ...(limitedBecause === undefined ? {} : { limited_because: limitedBecause }),
  };
}

export function definitionRunResultOf(outcome: Outcome): DefinitionRunResult {
  if (outcome.status === 'rejected') {
    const { reason, detail, issues, kind, because } = outcome;
    return {
      status: 'rejected',
      reason,
      detail,
      ...(issues === undefined ? {} : { issues }),
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
      ...whereAndWhenOf(outcome),
    };
  }
  if (outcome.status === 'failed') {
    return { status: 'failed', detail: `The run failed with incident ${outcome.incident}` };
  }
  return textField(outcome.output, 'status') === 'succeeded'
    ? { status: 'succeeded', output: field(outcome.output, 'output') ?? null }
    : { status: 'waiting' };
}

export function endedRunResultOf(ending: RunEnding): EndedRunResult {
  if (ending.type === 'run_succeeded') {
    return { status: 'succeeded', output: ending.data.output };
  }
  if (ending.type === 'run_failed') {
    const { incident } = ending.data;
    return {
      status: 'failed',
      detail: incident === undefined ? 'The run failed' : `The run failed with incident ${incident}`,
    };
  }
  return { status: 'rejected', ...ending.data.rejection };
}
