import type { AppRuntime } from '@on.auto/api';
import { eventEmitter, type PlaybookOperation, type PlaybookOwnNames } from '@on.auto/definitions';
import {
  playbookCallerOf,
  Ledger,
  type PlaybookRequest,
  type Dispatcher,
  type DispatcherServices,
} from '@on.auto/operations';
import { startAnswered, type ReactionOptions, type ReactionStart } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';

const workflows = 'workflow';

export interface Reacting {
  readonly startVersion: PlaybookOperation;
  readonly names: PlaybookOwnNames;
}

function requestOf({
  org,
  playbook,
  workflow,
  version,
  input,
  runId,
  depth,
  cause,
  trigger,
}: ReactionStart): PlaybookRequest {
  return {
    caller: playbookCallerOf({ org, playbook }),
    org,
    playbook,
    input: { type: workflows, name: workflow, version, input, run_id: runId },
    encoding: 'json',
    lineage: { causationId: cause, correlationId: runId },
    depth,
    trigger,
  };
}

export function reactionsOf(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { startVersion, names }: Reacting,
): Omit<ReactionOptions, 'filters'> {
  return {
    definitionType: workflows,
    start: (start) =>
      Effect.flatMap(
        inRuntime(runtime, dispatcher.dispatchToPlaybook(startVersion.registration, requestOf(start))),
        startAnswered,
      ),
    emit: (playbook, emission, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) => eventEmitter(ledger, names)(playbook, emission, lineage)),
      ),
  };
}
