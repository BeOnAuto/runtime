import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { freshInstances, machineSandboxOf, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';
import type { WorkflowHost } from '@on.auto/workflow-host';
import { recordedReactions, recordedWaiting, workflowHostOnALedger } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';

import { callResultOfEnding, definitionCalls } from '../calls/function-calls.ts';
import { workflowMachineOptionsOf } from '../runs/workflow-machine-options.ts';
import type { Playbook } from './playbook.ts';
import { testPlaybookNames } from './test-sandbox.ts';

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots());

const sandboxModule = await sandboxModuleIn(sandboxFiles);

export function testHost(nested: Playbook): Promise<WorkflowHost> {
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
      sweepEveryMs: 20,
      mostCallsAtOnce: 4,
      reactions: recordedReactions().options,
      waiting: { ...recordedWaiting().options, resultOf: callResultOfEnding },
    },
  );
}
