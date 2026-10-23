import type { TroublingReceipt } from '@on.auto/workflow-engine';
import type { Effect } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import type { RunAddress } from '../runs/run-address.ts';

export type HostNote =
  | { readonly kind: 'standing_by'; readonly holder: string; readonly until: number }
  | { readonly kind: 'took_over'; readonly holder: string }
  | {
      readonly kind: 'settle_backing_off';
      readonly run: RunAddress;
      readonly attempts: number;
      readonly detail: string;
    }
  | { readonly kind: 'settled_after_back_off'; readonly run: RunAddress; readonly attempts: number }
  | { readonly kind: 'offer_declined'; readonly run: RunAddress; readonly detail: string }
  | { readonly kind: 'run_record_passed'; readonly run: RunAddress; readonly version: number; readonly sweeps: number }
  | {
      readonly kind: 'record_unreadable';
      readonly org: string;
      readonly playbook: string;
      readonly recordId: string;
      readonly type: string;
    }
  | {
      readonly kind: 'record_passed_over';
      readonly playbook: string;
      readonly record: string;
      readonly reason: 'unreadable';
    }
  | {
      readonly kind: 'record_passed_over';
      readonly playbook: string;
      readonly record: string;
      readonly reason: 'refused';
      readonly by: string;
      readonly detail: string;
    }
  | { readonly kind: 'view_stalled'; readonly playbook: string; readonly name: string; readonly version: number }
  | {
      readonly kind: 'dataset_stalled';
      readonly playbook: string;
      readonly dataSha256: string;
      readonly record: string;
      readonly detail: string;
    };

export interface UnsettledRun extends RunAddress {
  readonly receipt: TroublingReceipt;
}

export interface HostReports {
  readonly unsettled: (run: UnsettledRun) => Effect.Effect<void>;
  readonly trouble: Trouble;
  readonly note: (note: HostNote) => Effect.Effect<void>;
}
