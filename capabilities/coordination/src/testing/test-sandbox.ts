import { playbookOwnNamesOf, type PlaybookOwnNames } from '@on.auto/definitions';
import { echo } from '@on.auto/definitions/testing';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import {
  reusedSandbox,
  type MachineOptions,
  type MachineSandbox,
  type MachineSettings,
} from '@on.auto/workflow-engine';
import { freshInstances, sandboxModuleIn, unitMemoryBytes } from '@on.auto/workflow-engine/dsl';

import { workflowFacts } from '../capability/workflow.ts';
import { workflowPolicyOf, type WorkflowPolicy } from '../document/workflow-functions.ts';
import { workflowMachineOptionsOf, workflowMachineSettingsOf } from '../runs/workflow-machine-options.ts';

export const testSandbox: MachineSandbox = reusedSandbox(
  await freshInstances(await sandboxModuleIn(shippedFilesOnDisk))(unitMemoryBytes),
  () => 0,
);

export const testPlaybookNames: PlaybookOwnNames = playbookOwnNamesOf([echo, workflowFacts]);

export const testWorkflowPolicy: WorkflowPolicy = workflowPolicyOf(testPlaybookNames);

export const testWorkflowSettings: MachineSettings = workflowMachineSettingsOf(testPlaybookNames);

export const testWorkflowOptions: MachineOptions = workflowMachineOptionsOf(testSandbox, testPlaybookNames);
