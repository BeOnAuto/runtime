import type { AppRuntime } from '@on.auto/api';
import {
  callResultOfEnding,
  definitionCalls,
  definitionRunResultOf,
  workflowMachineOptionsOf,
  type DefinitionRunRequest,
  type RunDefinition,
} from '@on.auto/coordination';
import {
  defineRunDefinition,
  deferredCanceller,
  runCanceller,
  runSettler,
  type PlaybookOperation,
  type PlaybookOwnNames,
  type Capability,
  type SettleRun,
} from '@on.auto/definitions';
import { Ledger, type Dispatcher, type DispatcherServices } from '@on.auto/operations';
import type { Evaluations } from '@on.auto/workflow-engine';
import type { HostOptions, WaitingOptions } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';
import { reactionsOf } from './reaction-dependencies.ts';

export type HostWork = Pick<HostOptions, 'machine' | 'perform' | 'settle' | 'reactions' | 'waiting'>;

export interface WorkParts {
  readonly capabilities: readonly Capability[];
  readonly startVersion: PlaybookOperation;
  readonly evaluations: Evaluations;
  readonly names: PlaybookOwnNames;
}

type RunInProcess = (run: Omit<DefinitionRunRequest, 'longestMs' | 'resumesAfterMs'>) => ReturnType<RunDefinition>;

function nestedRuns(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  runDefinition: PlaybookOperation,
): RunInProcess {
  return ({ org, playbook, caller, type, name, input, runId, lineage, depth, callDepth, calledBy, attemptDied }) =>
    inRuntime(
      runtime,
      dispatcher.dispatchToPlaybook(runDefinition.registration, {
        caller,
        org,
        playbook,
        input: { type, name, input, run_id: runId },
        encoding: 'json',
        lineage,
        depth,
        callDepth,
        calledBy,
        ...(attemptDied === undefined ? {} : { attemptDied }),
      }),
    ).pipe(Effect.map(definitionRunResultOf));
}

function settlements(runtime: AppRuntime<DispatcherServices>): SettleRun {
  return (run, settlement, lineage) =>
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (ledger) => runSettler(ledger)(run, settlement, lineage)),
    );
}

function waitingOf(runtime: AppRuntime<DispatcherServices>, capabilities: readonly Capability[]): WaitingOptions {
  return {
    resultOf: callResultOfEnding,
    cancel: (run, request, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) => runCanceller(ledger)(run, request, lineage)),
      ),
    cancelDeferred: (run, request, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) =>
          deferredCanceller(capabilities, ledger)(run, request, lineage),
        ),
      ),
  };
}

export function hostWorkOf(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { capabilities, startVersion, evaluations, names }: WorkParts,
): HostWork {
  return {
    machine: workflowMachineOptionsOf(evaluations.machine, names),
    perform: definitionCalls(nestedRuns(runtime, dispatcher, defineRunDefinition(capabilities))),
    settle: settlements(runtime),
    reactions: { ...reactionsOf(runtime, dispatcher, { startVersion, names }), filters: evaluations.filters },
    waiting: waitingOf(runtime, capabilities),
  };
}
