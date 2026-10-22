import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import { workflowMachine } from '../decider/workflow-machine.ts';
import { freshInstance } from '../instances/fresh-instances.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import { reusedSandbox, type MachineSandbox } from '../programs/reserved-instances.ts';
import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { testMachineOf } from '../testing/driver-inputs.ts';
import { memoryDriver, type DriverOptions, type MemoryDriver } from '../testing/memory-driver.ts';

export const testSandbox: MachineSandbox = reusedSandbox(
  await freshInstance(shippedFilesOnDisk, unitMemoryBytes),
  () => 0,
);

export const testMachine: MachineOptions = testMachineOf(testSandbox);

export function testSandboxStoppingAfter(stepsWithoutWaiting: number): MachineSandbox {
  return { ...testSandbox, mostStepsWithoutWaiting: stepsWithoutWaiting };
}

export const testWorkflowMachine: RunDecider = workflowMachine(testMachine);

export function testDriverOf(options: Omit<DriverOptions, 'sandbox'> = {}): MemoryDriver {
  return memoryDriver({ ...options, sandbox: testSandbox });
}
