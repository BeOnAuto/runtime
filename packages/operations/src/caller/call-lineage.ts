import { Context } from 'effect';

import type { Lineage } from '../ledger/message-lineage.ts';

export interface CallLink {
  readonly run_id: string;
  readonly reference: string;
  readonly run: number;
}

type TriggerKind = 'event' | 'cron' | 'every';

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
  readonly attemptDied: boolean;
}

export class CallLineage extends Context.Service<CallLineage, GivenLineage>()('@on.auto/operations/CallLineage') {}
