import type { Schema } from 'effect';

import type { Resolution } from './conflict.ts';
import { cappedIssues, type Issue } from './issue.ts';
import type { Options } from './options.ts';
import type { RejectionBecause } from './rejection-because.ts';
import type { DeclarableReason, RejectionKind } from './rejection.ts';

export type RejectionReason = 'forbidden' | DeclarableReason;

export interface Succeeded {
  readonly status: 'succeeded';
  readonly output: Schema.JsonObject;
}

export interface Rejected extends Resolution {
  readonly status: 'rejected';
  readonly reason: RejectionReason;
  readonly detail: string;
  readonly issues?: readonly Issue[];
  readonly kind?: RejectionKind;
  readonly because?: RejectionBecause;
  readonly options?: Options;
}

export interface Failed {
  readonly status: 'failed';
  readonly incident: string;
}

export interface Cancelled {
  readonly status: 'cancelled';
}

export type Outcome<S extends Succeeded = Succeeded> = S | Rejected | Failed;

export type Settled<S extends Succeeded = Succeeded> = Outcome<S> | Cancelled;

export function succeeded(output: Schema.JsonObject): Succeeded {
  return { status: 'succeeded', output };
}

export function rejected(
  reason: RejectionReason,
  detail: string,
  issues?: readonly Issue[],
  kind?: RejectionKind,
): Rejected {
  const described: Rejected =
    issues === undefined
      ? { status: 'rejected', reason, detail }
      : { status: 'rejected', reason, detail, issues: cappedIssues(issues) };
  return kind === undefined ? described : { ...described, kind };
}

export function cappedOptions({ question, choices }: Options): Options {
  return {
    question,
    choices: choices.map(({ value, title, issues }) => ({ value, title, issues: cappedIssues(issues) })),
  };
}

export function failed(incident: string): Failed {
  return { status: 'failed', incident };
}

export function cancelled(): Cancelled {
  return { status: 'cancelled' };
}
