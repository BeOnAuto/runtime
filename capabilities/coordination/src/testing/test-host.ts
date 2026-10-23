import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { freshInstances, machineSandboxOf, sandboxModuleIn } from '@on.auto/workflow-engine/dsl';
import { openWorkflowHost, type WorkflowHost } from '@on.auto/workflow-host';
import { recordedReactions, recordedWaiting } from '@on.auto/workflow-host/testing';
import { Effect, Function } from 'effect';

import { callResultOfEnding, definitionCalls } from '../calls/function-calls.ts';
import { workflowMachineOptionsOf } from '../runs/workflow-machine-options.ts';
import type { Playbook } from './playbook.ts';
import { testPlaybookNames } from './test-sandbox.ts';

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk);

export function testHost(nested: Playbook): Promise<WorkflowHost> {
  return openWorkflowHost({
    database: { store: 'sqlite', file: ':memory:' },
    machine: workflowMachineOptionsOf(machineSandboxOf(freshInstances(sandboxModule)), testPlaybookNames),
    perform: definitionCalls(nested.executeNested),
    settle: nested.settle,
    reports: {
      unsettled: Effect.logWarning,
      trouble: Effect.logWarning,
      lostConnection: Function.constVoid,
      note: Effect.logWarning,
    },
    sweepEveryMs: 20,
    mostCallsAtOnce: 4,
    reactions: recordedReactions().options,
    waiting: { ...recordedWaiting().options, resultOf: callResultOfEnding },
  });
}
