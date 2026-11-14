import { Context } from 'effect';

import type { Lineage } from '../ledger/message-lineage.ts';
import type { TriggerKind } from '../ledger/trigger-kinds.ts';

export interface CallLink {
  readonly run_id: string;
  readonly reference: string;
  readonly run: number;
}

export interface TriggerLink {
  readonly kind: TriggerKind;
  readonly reference: string;
}

export interface GivenLineage {
  readonly lineage: Lineage | null;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy: CallLink | null;
  readonly trigger: TriggerLink | null;
  readonly actsFor: string | null;
  readonly attemptDied: boolean;
}

export class CallLineage extends Context.Service<CallLineage, GivenLineage>()('@on.auto/operations/CallLineage') {}
