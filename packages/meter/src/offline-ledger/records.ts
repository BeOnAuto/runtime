import type { Statement } from '@on.auto/ledger';

export type OfflineAction = 'reserve' | 'dispatch' | 'release';

export interface OfflineCommand {
  readonly id: string;
  readonly payloadDigest: string;
  readonly reservationId: string;
  readonly kind: OfflineAction;
}

export interface OfflineReceipt {
  readonly commandId: string;
  readonly allocationId: string;
  readonly reservationId: string;
  readonly revision: number;
  readonly kind: OfflineAction;
  readonly units: bigint;
}

export type OfflineResult = OfflineReceipt & { readonly status: 'applied' | 'existing' };

export interface OfflineMovement {
  readonly lotId: string;
  readonly reservedDelta: bigint;
  readonly committedDelta: bigint;
}

export interface OfflineMutation {
  readonly allocationId: string;
  readonly revision: number;
  readonly now: number;
  readonly units: bigint;
  readonly movements: readonly OfflineMovement[];
  readonly claim: (attempt: string) => Statement;
  readonly writes: (attempt: string) => readonly Statement[];
}
