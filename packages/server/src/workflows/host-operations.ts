import { defineRunDefinition, defineStartVersion, type Capability, type PlaybookOperation } from '@on.auto/definitions';
import type { Dispatcher, DispatcherServices, Outcome, PlaybookRequest, Registration } from '@on.auto/operations';
import type { WorkflowHost } from '@on.auto/workflow-host';
import { Effect } from 'effect';

type HostOperationName = 'startVersion' | 'runDefinition';

export type HostOperations = Readonly<Record<HostOperationName, PlaybookOperation>>;

export type HostDispatch = (request: PlaybookRequest) => Effect.Effect<Outcome, never, DispatcherServices>;

export type HostDispatches = Readonly<Record<HostOperationName, HostDispatch>>;

interface HostOnceOpened {
  readonly runs: Pick<WorkflowHost, 'start' | 'deliver'>;
  readonly opened: (host: WorkflowHost) => void;
}

export function hostOperationsOf(capabilities: readonly Capability[]): HostOperations {
  return { startVersion: defineStartVersion(capabilities), runDefinition: defineRunDefinition(capabilities) };
}

export function hostRegistrationsOf(operations: HostOperations): readonly Registration<'playbook'>[] {
  return Object.values(operations).map(({ registration }) => registration);
}

export function hostDispatchesOf(
  dispatcher: Dispatcher,
  { startVersion, runDefinition }: HostOperations,
): HostDispatches {
  return {
    startVersion: (request) => dispatcher.dispatchToPlaybook(startVersion.registration, request),
    runDefinition: (request) => dispatcher.dispatchToPlaybook(runDefinition.registration, request),
  };
}

export function hostOnceOpened(): HostOnceOpened {
  const opening = Promise.withResolvers<WorkflowHost>();
  const host = Effect.promise(() => opening.promise);
  return {
    runs: {
      start: (run, start) => Effect.flatMap(host, (opened) => opened.start(run, start)),
      deliver: (run, event) => Effect.flatMap(host, (opened) => opened.deliver(run, event)),
    },
    opened: (opened) => {
      opening.resolve(opened);
    },
  };
}
