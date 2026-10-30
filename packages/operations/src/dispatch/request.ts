import type { CallLink, TriggerLink } from '../caller/call-lineage.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import type { InputEncoding } from '../definition/registered-run.ts';
import type { Lineage } from '../ledger/message-lineage.ts';
import type { CallSummary } from './incident-reporter.ts';

export interface OrgRequest {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly input: unknown;
  readonly encoding: InputEncoding;
}

export interface PlaybookRequest extends OrgRequest {
  readonly playbook: string;
  readonly lineage?: Lineage;
  readonly depth?: number;
  readonly callDepth?: number;
  readonly calledBy?: CallLink;
  readonly trigger?: TriggerLink;
  readonly attemptDied?: true;
}

export function callSummaryOf(operation: string, { org, caller }: OrgRequest, playbook?: string): CallSummary {
  return playbook === undefined
    ? { operation, org, caller: caller.id }
    : { operation, org, playbook, caller: caller.id };
}
