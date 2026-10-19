import type { CallFunctions } from '../dsl/call-functions.ts';
import { mostInputMs } from '../dsl/evaluation.ts';
import { isObject, type Json, type JsonObject } from '../dsl/json.ts';
import { rejection } from '../dsl/policy-checks.ts';
import type { CancelOrder, RunLimits, Started } from '../machine/run-input.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import type { MachineOptions, MachineSettings } from '../runner/run-descriptors.ts';

export interface StartRequest {
  readonly runId: string;
  readonly document: JsonObject;
  readonly input?: Json;
  readonly limits?: Partial<RunLimits>;
  readonly attributes?: JsonObject;
  readonly seed?: number;
}

export const testFunctions: CallFunctions = {
  argumentChecks: {
    notify: (arguments_, pointer) => (isObject(arguments_) ? [] : [rejection(pointer, 'notify takes with: { to }')]),
  },
  describe: (name) => `the function ${name}`,
  childOf: ({ function: name, reference, run, arguments: given }) =>
    isObject(given) ? `${name} at ${reference} #${run}` : undefined,
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through the functions it is given',
  howAWorkflowStarts: 'start it through its runtime',
};

export const testRuntime: JsonObject = { name: 'workflow-engine', version: '1', metadata: {} };

export const testSettings: MachineSettings = {
  functions: testFunctions,
  runtime: testRuntime,
  contextOf: (_, at) => ({
    at,
    by: 'tester',
    runId: 'the-run-of-the-test',
    definitionType: 'workflow',
    definitionName: 'tested',
    definitionVersion: 1,
  }),
};

export function testMachineOf(sandbox: MachineSandbox, settings: MachineSettings = testSettings): MachineOptions {
  return { ...settings, sandbox };
}

export function decidingWithin(sandbox: MachineSandbox, milliseconds: number): MachineSandbox {
  return { ...sandbox, clock: () => sandbox.clock() + milliseconds - mostInputMs };
}

export const defaultLimits: RunLimits = { mostDurationMs: 2_592_000_000, longestCallMs: 600_000 };

export const defaultSeed = 7;

export const testCancel: CancelOrder = { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' };

export function startedOf(request: StartRequest, at: number): Started {
  const { runId, document, input = {}, limits = {}, attributes = {}, seed = defaultSeed } = request;
  return {
    kind: 'started',
    runId,
    at,
    document,
    input,
    limits: { ...defaultLimits, ...limits },
    attributes,
    seed,
  };
}
