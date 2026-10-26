import { defineCancelRun, defineCreateDefinition, defineRunDefinition, type Capability } from '@on.auto/definitions';
import {
  allPermissions,
  Ledger,
  makeDispatcher,
  type LedgerPorts,
  type Outcome,
  type Registration,
} from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, Predicate } from 'effect';

interface Operation {
  readonly registration: Registration<'playbook'>;
}

export interface CancelsInACall {
  readonly create: (name: string, source: string) => Promise<Outcome>;
  readonly run: (name: string, input: object, runId: string) => Promise<Outcome>;
  readonly cancelled: () => readonly Outcome[];
}

const caller = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
} as const;

function isAFinish(command: unknown): boolean {
  return Predicate.hasProperty(command, 'type') && command.type === 'finish';
}

function runOfTheStream(stream: string): string {
  return stream.slice(stream.lastIndexOf('/') + 1);
}

export function cancelsInACall(capability: Capability): CancelsInACall {
  const memory = memoryLedger();
  const cancelled: Outcome[] = [];
  const cancelRun = defineCancelRun([capability]);
  const dispatcher = makeDispatcher([]);
  const ports: LedgerPorts = {
    ...memory.service,
    execute: (stream, decider, command, lineage) =>
      Effect.andThen(
        isAFinish(command)
          ? Effect.map(dispatch(cancelRun, { run_id: runOfTheStream(stream) }), (outcome) => {
              cancelled.push(outcome);
            })
          : Effect.void,
        memory.service.execute(stream, decider, command, lineage),
      ),
  };
  const services = Layer.mergeAll(
    Layer.succeed(Ledger, ports),
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
  );
  function dispatch(operation: Operation, input: object): Effect.Effect<Outcome> {
    return dispatcher
      .dispatchToPlaybook(operation.registration, { caller, org: 'acme', playbook: 'alpha', input, encoding: 'json' })
      .pipe(Effect.provide(services));
  }
  const createDefinition = defineCreateDefinition([capability]);
  const runDefinition = defineRunDefinition([capability]);
  return {
    create: (name, source) => Effect.runPromise(dispatch(createDefinition, { type: capability.type, name, source })),
    run: (name, input, runId) =>
      Effect.runPromise(dispatch(runDefinition, { type: capability.type, name, input, run_id: runId })),
    cancelled: () => cancelled,
  };
}
