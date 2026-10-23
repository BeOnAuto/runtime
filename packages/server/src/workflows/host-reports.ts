import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { HostReports } from '@on.auto/workflow-host';

import { logHostNote } from '../logging/host-notes.ts';
import { logUnsettled, logWorkflowTrouble } from '../logging/logging.ts';
import { inRuntime } from './in-runtime.ts';

const unsettledBecause = {
  unknown_run: 'The ledger has no such run',
  settled_otherwise: 'The run was settled otherwise before',
} as const;

export function hostReports(runtime: AppRuntime<DispatcherServices>): HostReports {
  return {
    unsettled: ({ org, playbook, runId, receipt }) =>
      inRuntime(runtime, logUnsettled({ org, playbook, runId, reason: unsettledBecause[receipt] })),
    trouble: (what, cause) => inRuntime(runtime, logWorkflowTrouble(what, cause)),
    note: (note) => inRuntime(runtime, logHostNote(note)),
  };
}
