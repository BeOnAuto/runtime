import { workflowMachine } from '../decider/workflow-machine.ts';
import { freshInstances } from '../instances/fresh-instances.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import { reservedSandbox, reusedSandbox, type MachineSandbox } from '../programs/reserved-instances.ts';
import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { testMachineOf } from '../testing/driver-inputs.ts';
import { memoryDriver, type DriverOptions, type MemoryDriver } from '../testing/memory-driver.ts';
import { sandboxModuleOnDisk } from './test-pools.ts';

const testInstance = await freshInstances(sandboxModuleOnDisk)(unitMemoryBytes);

export const testSandbox: MachineSandbox = reusedSandbox(testInstance, () => 0);

export interface CountedSandbox {
  readonly sandbox: MachineSandbox;
  readonly prepared: () => number;
}

export function countedReservedSandbox(): CountedSandbox {
  const count = { prepared: 0 };
  const prepare = () => {
    count.prepared += 1;
    return Promise.resolve(testInstance);
  };
  return { sandbox: reservedSandbox(prepare, () => 0), prepared: () => count.prepared };
}

export const testMachine: MachineOptions = testMachineOf(testSandbox);

export function testSandboxStoppingAfter(stepsWithoutWaiting: number): MachineSandbox {
  return { ...testSandbox, mostStepsWithoutWaiting: stepsWithoutWaiting };
}

export const testWorkflowMachine: RunDecider = workflowMachine(testMachine);

export function testDriverOf(options: Omit<DriverOptions, 'sandbox'> = {}): MemoryDriver {
  return memoryDriver({ ...options, sandbox: testSandbox });
}
