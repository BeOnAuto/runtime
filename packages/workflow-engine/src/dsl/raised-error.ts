import { IssueSchema, isKindWithType, problemTypeOf, refusalInWords, type RejectedCall } from '@on.auto/operations';
import { asSentence } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { ErrorCauseSchema, type DslError } from '../machine/dsl-error.ts';
import { mostOutputBytes } from '../machine/limits.ts';
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

export function errorAsJson(error: DslError): JsonObject {
  const { type, status, instance, title, detail, kind, because, issues, cause } = error;
  return {
    type,
    status,
    instance,
    ...(title === undefined ? {} : { title }),
    ...(detail === undefined ? {} : { detail }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
    ...(issues === undefined ? {} : { issues }),
    ...(cause === undefined ? {} : { cause }),
  };
}

const isIssueList = Schema.is(Schema.Array(IssueSchema));

const isErrorCause = Schema.is(ErrorCauseSchema);

function issuesIn(definition: JsonObject): Pick<DslError, 'issues'> {
  const issues = field(definition, 'issues');
  return isIssueList(issues) ? { issues } : {};
}

function causeIn(definition: JsonObject): Pick<DslError, 'cause'> {
  const cause = field(definition, 'cause');
  return isErrorCause(cause) ? { cause } : {};
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
    ...causeIn(definition),
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

export function unworkableOutputOf(title: string, instance: string): DslError {
  return { type: problemTypeOf('conflict'), status: 409, title, instance, kind: 'unworkable' };
}

export type OutputOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number };

export function outcomeOfOutput(output: Json): OutputOutcome {
  const bytes = jsonBytesOf(output);
  return bytes > mostOutputBytes ? { kind: 'oversized', bytes, most: mostOutputBytes } : { kind: 'completed', output };
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
  readonly child?: string;
}

type Classification = readonly [ErrorKind, number];

const reasonsWithTypes: ReadonlySet<string> = new Set(['cancelled', 'unanswered']);

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

function codesOf(result: RejectedCall) {
  const { reason, kind, because } = result.cause?.status === 'rejected' ? result.cause : result;
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
  };
}

function causedBy(result: FailedCall, { child }: CallSite): Pick<DslError, 'cause'> {
  const started = child === undefined ? {} : { run_id: child };
  return result.status === 'rejected'
    ? { cause: { status: result.status, ...started, ...codesOf(result) } }
    : { cause: { status: result.status, ...started } };
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
      ...causedBy(result, call),
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
    ...causedBy(result, call),
  };
}
