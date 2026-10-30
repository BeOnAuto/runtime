import type { CallerIdentity, Issue, Settlement } from '@on.auto/operations';
import type { Json, JsonObject } from '@on.auto/workflow-engine';

export interface DefinitionCall {
  readonly org: string;
  readonly playbook: string;
  readonly caller: CallerIdentity;
  readonly reference: string;
  readonly run: number;
  readonly type: string;
  readonly name: string;
  readonly input: Json;
}

export type DefinitionCallResult =
  | { readonly status: 'succeeded'; readonly output: Json }
  | {
      readonly status: 'rejected';
      readonly reason: string;
      readonly detail: string;
      readonly kind?: string;
      readonly because?: string;
      readonly issues?: readonly Issue[];
    }
  | { readonly status: 'failed'; readonly detail: string };

export type RunSettlement = Settlement;

export interface SettleRequest {
  readonly org: string;
  readonly playbook: string;
  readonly definition: string;
  readonly runId: string;
  readonly settlement: RunSettlement;
}

export interface WorkflowRun {
  readonly document: JsonObject;
  readonly input: Json;
  readonly run: {
    readonly id: string;
    readonly org: string;
    readonly playbook: string;
    readonly definition: { readonly name: string; readonly version: number };
  };
  readonly caller: CallerIdentity;
  readonly mostDuration: number;
  readonly longestNestedRunMs: number;
}

export const defaultMostDuration = 2_592_000_000;

export const defaultLongestNestedRunMs = 600_000;
