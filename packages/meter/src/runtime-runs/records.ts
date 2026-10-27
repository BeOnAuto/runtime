import type { RunAdmission } from '@on.auto/definitions';
import type { ConnectionPorts } from '@on.auto/ledger';
import type { StreamReader } from '@on.auto/operations';

import type { SelfHostedMeter } from '../self-hosted/records.ts';

export interface SingleRunLimits {
  readonly deadlineMs: number;
  readonly budget: number;
  readonly memoryBytes: number;
}

export interface RuntimeRunOptions {
  readonly connection: ConnectionPorts;
  readonly meter: SelfHostedMeter;
  readonly limits: Readonly<Record<'computation' | 'recall', SingleRunLimits>>;
}

export interface ReconcileRunsRequest {
  readonly reader: StreamReader;
  readonly afterId?: string;
}

export interface ReconciledRuns {
  readonly inspected: number;
  readonly settled: number;
  readonly pending: number;
  readonly failed: number;
  readonly afterId: string | undefined;
}

export interface RuntimeRuns {
  readonly admission: RunAdmission['Service'];
  readonly reconcile: (request: ReconcileRunsRequest) => Promise<ReconciledRuns>;
}
