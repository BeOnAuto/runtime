import {
  asSentence,
  IssueSchema,
  isKindWithType,
  problemTypeOf,
  reasonOfKind,
  refusalInWords,
  RejectionBecauseSchema,
  UnansweredKindSchema,
  type ConflictKind,
  type KindWithType,
  type RejectedCall,
  type Settlement,
} from '@on.auto/operations';
import { Schema } from 'effect';

import type { DslError } from '../machine/dsl-error.ts';
import { mostOutputBytes } from '../machine/limits.ts';
import type { CancelOrder } from '../machine/run-input.ts';
import { field, jsonBytesOf, textField, type Json, type JsonObject } from './json.ts';
import { stepNamedAt } from './tasks.ts';

export type ErrorKind =
  | 'configuration'
  | 'validation'
  | 'expression'
  | 'authentication'
  | 'authorization'
  | 'timeout'
  | 'communication'
  | 'runtime';

export class RaisedError extends Error {
  readonly error: DslError;

  constructor(error: DslError) {
    super(error.title ?? error.type);
    this.name = 'RaisedError';
    this.error = error;
  }
}

export type SettledOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'raised'; readonly error: DslError }
  | { readonly kind: 'cancelled'; readonly cancel: CancelOrder }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number }
  | { readonly kind: 'overran'; readonly milliseconds: number };

export function caughtRaise<A>(attempt: () => A, onRaise: (error: DslError) => A): A {
  try {
    return attempt();
  } catch (error) {
    if (!(error instanceof RaisedError)) {
      throw error;
    }
    return onRaise(error.error);
  }
}

const standardErrorTypes = 'https://open-workflow-specification.org/spec/1.0.0/errors/';

export function errorType(kind: ErrorKind): string {
  return `${standardErrorTypes}${kind}`;
}

export function raised(kind: ErrorKind, status: number, title: string, instance: string): RaisedError {
  return new RaisedError({ type: errorType(kind), status, title, instance });
}

export function errorAsJson({ type, status, instance, title, detail, kind, because, issues }: DslError): JsonObject {
  return {
    type,
    status,
    instance,
    ...(title === undefined ? {} : { title }),
    ...(detail === undefined ? {} : { detail }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
    ...(issues === undefined ? {} : { issues }),
  };
}

const isIssueList = Schema.is(Schema.Array(IssueSchema));

function issuesIn(definition: JsonObject): Pick<DslError, 'issues'> {
  const issues = field(definition, 'issues');
  return isIssueList(issues) ? { issues } : {};
}

export function errorFromJson(definition: JsonObject, instance: string): DslError | undefined {
  const type = textField(definition, 'type');
  const status = field(definition, 'status');
  if (type === undefined || typeof status !== 'number' || !Number.isInteger(status)) {
    return undefined;
  }
  const title = textField(definition, 'title');
  const detail = textField(definition, 'detail');
  const kind = textField(definition, 'kind');
  const because = textField(definition, 'because');
  return {
    type,
    status,
    instance: textField(definition, 'instance') ?? instance,
    ...(title === undefined ? {} : { title }),
    ...(detail === undefined ? {} : { detail }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
    ...issuesIn(definition),
  };
}

const theWholeWorkflow: ReadonlySet<string> = new Set(['', '/']);

function placeOf(instance: string): string {
  const step = stepNamedAt(instance);
  if (step !== undefined) {
    return `, at the step ${step}`;
  }
  return theWholeWorkflow.has(instance) ? '' : `, at ${instance}`;
}

function withoutFinalPeriod(text: string): string {
  return text.replace(/\.$/u, '');
}

export function describeError({ type, title, detail, instance }: DslError): string {
  const opening = `${withoutFinalPeriod(title ?? type)}${placeOf(instance)}`;
  return detail === undefined ? `${opening}.` : `${opening}: ${asSentence(detail)}`;
}

const retryableStatuses: ReadonlySet<number> = new Set([408, 429]);

const isRejectionBecause = Schema.is(RejectionBecauseSchema);

const isUnansweredKind = Schema.is(UnansweredKindSchema);

const unansweredType = problemTypeOf('unanswered');

const conflictType = problemTypeOf('conflict');

const reasonsWithTypes: ReadonlySet<string> = new Set(['cancelled', 'unanswered']);

export function reasonOfStatus(status: number): 'invalid_input' | 'unavailable' {
  return status >= 400 && status < 500 && !retryableStatuses.has(status) ? 'invalid_input' : 'unavailable';
}

type ConflictKindWithType = Extract<KindWithType, ConflictKind>;

function isConflictKind(kind: KindWithType): kind is ConflictKindWithType {
  return reasonOfKind(kind) === 'conflict';
}

function becauseOf(kind: KindWithType, because: string | undefined) {
  return kind === 'tools_called' || !isRejectionBecause(because) ? {} : { because };
}

function ownTypeRejectionOf(kind: KindWithType, detail: string, because: string | undefined): Settlement {
  const known = becauseOf(kind, because);
  return isConflictKind(kind)
    ? { status: 'rejected', reason: 'conflict', detail, kind, ...known }
    : { status: 'rejected', reason: 'unavailable', detail, kind, ...known };
}

export function unworkableOutputOf(title: string, instance: string): DslError {
  return { type: conflictType, status: 409, title, instance, kind: 'unworkable' };
}

function settledRejectionOf(error: DslError): Settlement {
  const detail = describeError(error);
  const { type, kind, because } = error;
  if (type === unansweredType && isUnansweredKind(kind)) {
    return { status: 'rejected', reason: 'unanswered', kind, detail };
  }
  if (type === conflictType && kind === 'unworkable') {
    return { status: 'rejected', reason: 'conflict', kind, detail };
  }
  if (isKindWithType(kind) && type === problemTypeOf(kind)) {
    return ownTypeRejectionOf(kind, detail, because);
  }
  const reason = reasonOfStatus(error.status);
  return reason === 'invalid_input' && error.issues !== undefined
    ? { status: 'rejected', reason, detail, issues: error.issues }
    : { status: 'rejected', reason, detail };
}

export type OutputOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number };

export function outcomeOfOutput(output: Json): OutputOutcome {
  const bytes = jsonBytesOf(output);
  return bytes > mostOutputBytes ? { kind: 'oversized', bytes, most: mostOutputBytes } : { kind: 'completed', output };
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

export type FailedCall =
  | RejectedCall
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'unreachable'; readonly detail: string };

export interface CallSite {
  readonly function: string;
  readonly label: string;
  readonly reference: string;
  readonly refused?: string;
}

type Classification = readonly [ErrorKind, number];

const rejections: Readonly<Record<string, Classification>> = {
  invalid_input: ['validation', 400],
  forbidden: ['authorization', 403],
  not_found: ['configuration', 404],
  conflict: ['runtime', 409],
  unavailable: ['communication', 503],
  cancelled: ['runtime', 409],
  unanswered: ['runtime', 410],
};

function namedBy({ kind, because, issues }: RejectedCall): Pick<DslError, 'kind' | 'because' | 'issues'> {
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
    ...(issues === undefined ? {} : { issues }),
  };
}

function typeOfRejection(result: FailedCall, kind: string | undefined): string | undefined {
  if (result.status === 'rejected' && reasonsWithTypes.has(result.reason)) {
    return problemTypeOf(result.reason);
  }
  return isKindWithType(kind) ? problemTypeOf(kind) : undefined;
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function callErrorOf(result: FailedCall, call: CallSite): DslError {
  if (result.status === 'unreachable') {
    return {
      type: errorType('communication'),
      status: 503,
      title: `${call.function} could not reach ${call.label}`,
      detail: result.detail,
      instance: call.reference,
    };
  }
  const [kind, status]: Classification =
    result.status === 'rejected' ? (rejections[result.reason] ?? ['runtime', 500]) : ['runtime', 500];
  const ownKind = result.status === 'rejected' ? result.kind : undefined;
  return {
    type: typeOfRejection(result, ownKind) ?? errorType(kind),
    status,
    title:
      result.status === 'rejected'
        ? `${capitalized(call.label)} ${call.refused ?? refusalInWords(result.reason)}`
        : `${capitalized(call.label)} failed`,
    detail: result.detail,
    instance: call.reference,
    ...(result.status === 'rejected' ? namedBy(result) : {}),
  };
}
