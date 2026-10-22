import type { EmitEvent } from '@on.auto/definitions';
import type { StreamSignal } from '@on.auto/ledger';
import type { StartingTrigger } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Data, type Effect, type Schema } from 'effect';

import type { SpanReference } from '../runs/run-spans.ts';
import type { StartRejected } from './start-rejected.ts';

export interface ReactionStart {
  readonly org: string;
  readonly playbook: string;
  readonly workflow: string;
  readonly version: number;
  readonly runId: string;
  readonly input: Schema.Json;
  readonly depth: number;
  readonly cause: string;
  readonly trigger: StartingTrigger;
  readonly trace?: SpanReference;
}

export class StartRefused extends Data.TaggedError('start_refused')<{ readonly detail: string }> {}

export type StartReaction = (start: ReactionStart) => Effect.Effect<void, StartRefused | StartRejected>;

export interface ReactionOptions {
  readonly definitionType: string;
  readonly start: StartReaction;
  readonly emit: EmitEvent;
  readonly appended?: StreamSignal;
  readonly filters: FilterSandbox;
}
