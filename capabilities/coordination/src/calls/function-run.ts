import type {
  CallLink,
  CallerIdentity,
  Issue,
  Lineage,
  RejectionKind,
  RejectionReason,
  RejectionBecause,
} from '@on.auto/operations';
import type { Effect, Schema } from 'effect';

export interface DefinitionRunRequest {
  readonly org: string;
  readonly playbook: string;
  readonly caller: CallerIdentity;
  readonly type: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly runId: string;
  readonly lineage: Lineage;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy: CallLink;
  readonly attemptDied?: true;
}

export type EndedRunResult =
  | { readonly status: 'succeeded'; readonly output: Schema.Json }
  | {
      readonly status: 'rejected';
      readonly reason: RejectionReason;
      readonly detail: string;
      readonly issues?: readonly Issue[];
      readonly kind?: RejectionKind;
      readonly because?: RejectionBecause;
    }
  | { readonly status: 'failed'; readonly detail: string };

export type DefinitionRunResult = EndedRunResult | { readonly status: 'waiting' };

export type RunDefinition = (run: DefinitionRunRequest) => Effect.Effect<DefinitionRunResult>;
