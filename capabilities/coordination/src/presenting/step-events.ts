import type { PresentedFact } from '@on.auto/operations';
import { isRecordedStep, keyOf, type RunLogEvent, type Step, type StepKey } from '@on.auto/workflow-engine';
import type { Schema } from 'effect';

import { cutAtCodePoint } from './cut-text.ts';
import { stepSummaryOf } from './run-words.ts';

const mostReferenceBytes = 256;

const mostErrorTypeBytes = 256;

const mostErrorTitleBytes = 1024;

const publicTypes: Readonly<Record<Step['outcome'], string>> = {
  started: 'step_started',
  waiting: 'step_waiting',
  completed: 'step_finished',
  raised: 'step_failed',
  timed_out: 'step_failed',
  cancelled: 'step_failed',
  skipped: 'step_skipped',
};

export const stepEventTypes: readonly string[] = [...new Set(Object.values(publicTypes))];

interface ErrorShown {
  readonly error?: { readonly type: string; readonly title?: string };
}

function errorShown(error: Step['error']): ErrorShown {
  if (error === undefined) {
    return {};
  }
  const type = cutAtCodePoint(error.type, mostErrorTypeBytes);
  return {
    error: error.title === undefined ? { type } : { type, title: cutAtCodePoint(error.title, mostErrorTitleBytes) },
  };
}

function refusalShown(refusal: Step['refusal']): Readonly<Record<string, string>> {
  if (refusal === undefined) {
    return {};
  }
  const { kind, because, detail, resolve_at: resolveAt, retry_at: retryAt, until } = refusal;
  return {
    detail,
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
    retry_at: new Date(retryAt).toISOString(),
    until: new Date(until).toISOString(),
  };
}

function dataOf(step: Step): Schema.JsonObject {
  const { name, reference, run, times, outcome, error, waits_for: waitsFor, child } = step;
  const shown = {
    name,
    reference: cutAtCodePoint(reference, mostReferenceBytes),
    run,
    times,
    ...(waitsFor === undefined ? {} : { waits_for: waitsFor }),
    ...(child === undefined ? {} : { run_id: child }),
    ...refusalShown(step.refusal),
  };
  return publicTypes[outcome] === 'step_failed' ? { ...shown, outcome, ...errorShown(error) } : shown;
}

function keyTextOf({ reference, run, outcome, times }: StepKey): string {
  return JSON.stringify([reference, run, outcome, times]);
}

export function stepFactsOf(event: RunLogEvent): readonly PresentedFact[] {
  const recorded = event.steps.filter((step) => isRecordedStep(step));
  const numbers = new Map(recorded.map((step, index) => [keyTextOf(keyOf(step)), index + 1]));
  return recorded.map((step, index) => ({
    type: publicTypes[step.outcome],
    summary: stepSummaryOf(step),
    data: dataOf(step),
    part: {
      number: index + 1,
      causedBy: step.caused_by === 'input' ? 0 : (numbers.get(keyTextOf(step.caused_by)) ?? 0),
    },
  }));
}
