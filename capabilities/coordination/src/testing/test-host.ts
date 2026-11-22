import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { freshInstances, machineSandboxOf, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';
import type { WorkflowHost } from '@on.auto/workflow-host';
import {
  recordedReactions,
  recordedWaiting,
  workflowHostOnALedger,
  type SteppedClock,
} from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';

import { callResultOfEnding, definitionCalls } from '../calls/function-calls.ts';
import { workflowMachineOptionsOf } from '../runs/workflow-machine-options.ts';
import type { Playbook } from './playbook.ts';
import { testPlaybookNames } from './test-sandbox.ts';

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots());

const sandboxModule = await sandboxModuleIn(sandboxFiles);

export const hostSweepsEveryMs = 20;

/** A workflow host over a ledger in memory, which sleeps on the stepped clock it is handed and is watched by it for rest. */
export function testHost(nested: Playbook, clock: SteppedClock): Promise<WorkflowHost> {
  return workflowHostOnALedger(
    { store: 'sqlite', file: ':memory:' },
    {
      machine: workflowMachineOptionsOf(machineSandboxOf(freshInstances(sandboxModule)), testPlaybookNames),
      perform: definitionCalls(nested.executeNested),
      settle: nested.settle,
      reports: {
        unsettled: Effect.logWarning,
        trouble: Effect.logWarning,
        note: Effect.logWarning,
      },
      sweepEveryMs: hostSweepsEveryMs,
      clock,
      context: clock.watching(),
      mostCallsAtOnce: 4,
      reactions: recordedReactions().options,
      waiting: { ...recordedWaiting().options, resultOf: callResultOfEnding },
    },
  );
}
