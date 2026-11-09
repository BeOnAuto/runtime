import {
  isKindWithType,
  problemTypeOf,
  reasonOfKind,
  RejectionBecauseSchema,
  RejectionCauseSchema,
  UnansweredKindSchema,
  type ConflictKind,
  type KindWithType,
  type RejectionCause,
  type Settlement,
  type UnavailableKind,
} from '@on.auto/operations';
import { Schema } from 'effect';

import type { DslError, ErrorCause } from '../machine/dsl-error.ts';
import type { CancelOrder } from '../machine/run-input.ts';
import type { Json } from './json.ts';
import { describeError } from './raised-error.ts';
import { stepNamedAt } from './tasks.ts';

export type SettledOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'raised'; readonly error: DslError }
  | { readonly kind: 'cancelled'; readonly cancel: CancelOrder }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number }
  | { readonly kind: 'overran'; readonly milliseconds: number };

const retryableStatuses: ReadonlySet<number> = new Set([408, 429]);

const isRejectionBecause = Schema.is(RejectionBecauseSchema);

const isUnansweredKind = Schema.is(UnansweredKindSchema);

const unansweredType = problemTypeOf('unanswered');

const conflictType = problemTypeOf('conflict');

export function reasonOfStatus(status: number): 'invalid_input' | 'unavailable' {
  return status >= 400 && status < 500 && !retryableStatuses.has(status) ? 'invalid_input' : 'unavailable';
}

type ConflictKindWithType = Extract<KindWithType, ConflictKind>;

type UnavailableKindWithType = Extract<KindWithType, UnavailableKind>;

function isConflictKind(kind: KindWithType): kind is ConflictKindWithType {
  return reasonOfKind(kind) === 'conflict';
}

function isUnavailableKind(kind: KindWithType): kind is UnavailableKindWithType {
  return reasonOfKind(kind) === 'unavailable';
}

function becauseOf(kind: KindWithType, because: string | undefined) {
  return kind === 'tools_called' || !isRejectionBecause(because) ? {} : { because };
}

const isRejectionCause = Schema.is(RejectionCauseSchema);

type Caused = Pick<Extract<Settlement, { readonly cause?: RejectionCause }>, 'cause'>;

function codesOf({ status, reason, kind, because }: ErrorCause) {
  if (status !== 'rejected') {
    return {};
  }
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
  };
}

function causeOf(error: DslError): Caused {
  const { instance, cause } = error;
  if (cause === undefined || stepNamedAt(instance) === undefined) {
    return {};
  }
  const named = {
    step: instance.slice(1),
    ...(cause.run_id === undefined ? {} : { run_id: cause.run_id }),
    status: cause.status,
    ...codesOf(cause),
  };
  return isRejectionCause(named) ? { cause: named } : {};
}

function ownTypeRejectionOf(
  kind: KindWithType,
  detail: string,
  because: string | undefined,
  caused: Caused,
): Settlement {
  const known = becauseOf(kind, because);
  if (isConflictKind(kind)) {
    return { status: 'rejected', reason: 'conflict', detail, kind, ...known, ...caused };
  }
  return isUnavailableKind(kind)
    ? { status: 'rejected', reason: 'unavailable', detail, kind, ...known, ...caused }
    : { status: 'rejected', reason: 'invalid_input', detail, kind, ...caused };
}

function settledRejectionOf(error: DslError): Settlement {
  const detail = describeError(error);
  const caused = causeOf(error);
  const { type, kind, because } = error;
  if (type === unansweredType && isUnansweredKind(kind)) {
    return { status: 'rejected', reason: 'unanswered', kind, detail, ...caused };
  }
  if (type === conflictType && kind === 'unworkable') {
    return { status: 'rejected', reason: 'conflict', kind, detail, ...caused };
  }
  if (isKindWithType(kind) && type === problemTypeOf(kind)) {
    return ownTypeRejectionOf(kind, detail, because, caused);
  }
  const reason = reasonOfStatus(error.status);
  return reason === 'invalid_input' && error.issues !== undefined
    ? { status: 'rejected', reason, detail, issues: error.issues, ...caused }
    : { status: 'rejected', reason, detail, ...caused };
}

function endingOf(outcome: Exclude<SettledOutcome, { readonly kind: 'completed' | 'raised' }>): Settlement {
  if (outcome.kind === 'cancelled') {
    const { by, kind, reason } = outcome.cancel;
    return { status: 'rejected', reason: 'cancelled', kind, detail: reason, by };
  }
  if (outcome.kind === 'overran') {
    const detail = `The workflow ran for ${outcome.milliseconds} ms, the most a workflow may run, and was stopped`;
    return { status: 'rejected', reason: 'cancelled', kind: 'overrun', detail };
  }
  if (outcome.kind === 'oversized') {
    const detail = `The output of the workflow takes ${outcome.bytes} bytes as JSON, more than the ${outcome.most} a run records`;
    return { status: 'rejected', reason: 'conflict', kind: 'oversized', detail };
  }
  return { status: 'failed' };
}

export function settlementOf(outcome: SettledOutcome): Settlement {
  if (outcome.kind === 'completed') {
    return { status: 'succeeded', output: outcome.output };
  }
  return outcome.kind === 'raised' ? settledRejectionOf(outcome.error) : endingOf(outcome);
}
