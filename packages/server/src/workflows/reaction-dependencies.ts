import type { AppRuntime } from '@on.auto/api';
import { eventEmitter, type PlaybookOwnNames } from '@on.auto/definitions';
import { playbookCallerOf, Ledger, type PlaybookRequest, type DispatcherServices } from '@on.auto/operations';
import {
  functionStartAnswered,
  startAnswered,
  startedVersionOf,
  type FunctionStart,
  type ReactionOptions,
  type ReactionStart,
  type StartFunction,
} from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { goalNoticesOnNode } from '../goals/notices/goal-notices.ts';
import type { StartingWork } from './host-dependencies.ts';
import type { HostDispatch } from './host-operations.ts';
import { inRuntime } from './in-runtime.ts';

const workflows = 'workflow';

function requestOf(start: ReactionStart): PlaybookRequest {
  const { org, playbook, runId, depth, cause, trigger } = start;
  return {
    caller: playbookCallerOf({ org, playbook }),
    org,
    playbook,
    input: startedVersionOf(start),
    encoding: 'json',
    lineage: { causationId: cause, correlationId: runId },
    depth,
    trigger,
  };
}

function functionRequestOf({ org, playbook, type, name, runId, input, trigger }: FunctionStart): PlaybookRequest {
  return {
    caller: playbookCallerOf({ org, playbook }),
    org,
    playbook,
    input: { type, name, input, run_id: runId },
    encoding: 'json',
    lineage: { causationId: null, correlationId: runId },
    depth: 0,
    trigger,
  };
}

export function functionStartOf(runtime: AppRuntime<DispatcherServices>, startVersion: HostDispatch): StartFunction {
  return (start) => Effect.flatMap(inRuntime(runtime, startVersion(functionRequestOf(start))), functionStartAnswered);
}

export function reactionsOf(
  runtime: AppRuntime<DispatcherServices>,
  startVersion: HostDispatch,
  names: PlaybookOwnNames,
): Omit<ReactionOptions, 'filters'> {
  return {
    definitionType: workflows,
    start: (start) => Effect.flatMap(inRuntime(runtime, startVersion(requestOf(start))), startAnswered),
    emit: (playbook, emission, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) => eventEmitter(ledger, names)(playbook, emission, lineage)),
      ),
  };
}

export function startingWorkWhere(results: boolean, given: StartingWork | undefined): StartingWork | undefined {
  return given ?? (results ? goalNoticesOnNode : undefined);
}
