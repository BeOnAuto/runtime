import type { EmitEvent } from '@on.auto/definitions';
import type { StreamSignal } from '@on.auto/ledger';
import type { Outcome, StartingTrigger } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Data, Effect, type Schema } from 'effect';

import type { SpanReference } from '../runs/run-spans.ts';
import { codesOf, type FailureDetail } from './refusals.ts';
import { StartRejected } from './start-rejected.ts';

export interface ReactionStart {
  readonly org: string;
  readonly playbook: string;
  readonly definitionKey: string;
  readonly workflow: string;
  readonly version: number;
  readonly runId: string;
  readonly input: Schema.Json;
  readonly depth: number;
  readonly cause: string;
  readonly trigger: StartingTrigger;
  readonly trace?: SpanReference;
}

export interface GoalTrigger extends StartingTrigger {
  readonly kind: 'goal';
}

export interface FunctionStart {
  readonly org: string;
  readonly playbook: string;
  readonly type: 'interaction';
  readonly name: string;
  readonly runId: string;
  readonly input: Schema.Json;
  readonly trigger: GoalTrigger;
}

export class StartRefused extends Data.TaggedError('start_refused')<FailureDetail> {}

export type StartReaction = (start: ReactionStart) => Effect.Effect<void, StartRefused | StartRejected>;

export type StartFunction = (start: FunctionStart) => Effect.Effect<void, StartRefused | StartRejected>;

export function startAnswered(outcome: Outcome): Effect.Effect<void, StartRefused | StartRejected> {
  if (outcome.status === 'succeeded') {
    return Effect.void;
  }
  if (outcome.status === 'failed') {
    return Effect.fail(new StartRefused({ detail: `The start failed with incident ${outcome.incident}` }));
  }
  const refusal = { detail: outcome.detail, ...codesOf(outcome) };
  return outcome.reason === 'unavailable'
    ? Effect.fail(new StartRefused(refusal))
    : Effect.fail(new StartRejected(refusal));
}

const endingsOfARunThatStands: ReadonlySet<string> = new Set(['unanswered', 'cancelled']);

export function functionStartAnswered(outcome: Outcome): Effect.Effect<void, StartRefused | StartRejected> {
  return outcome.status === 'rejected' && endingsOfARunThatStands.has(outcome.reason)
    ? Effect.void
    : startAnswered(outcome);
}

export interface ReactionOptions {
  readonly definitionType: string;
  readonly start: StartReaction;
  readonly emit: EmitEvent;
  readonly appended?: StreamSignal;
  readonly filters: FilterSandbox;
}
