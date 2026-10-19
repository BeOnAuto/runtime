import type { PlaybookOperation } from '@on.auto/definitions';
import {
  allPermissions,
  contentOfBytes,
  contentOfText,
  Ledger,
  makeDispatcher,
  settle,
  type CallerIdentity,
  type HttpRegistration,
  type Outcome,
  type Settled,
  type Succeeded,
} from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter, type MemoryLedger } from '@on.auto/operations/testing';
import type { DueWork } from '@on.auto/workflow-host';
import { Clock, Effect, Layer } from 'effect';

import type { ChildStart, ChildStarted } from '../capability/prediction-ports.ts';

const alpha = { org: 'acme', playbook: 'alpha' } as const;

const owner: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' };

interface HttpOperation {
  readonly registration: HttpRegistration<'playbook'>;
}

export type PlaybookDue = readonly DueWork[];

export function performedOn(clock: Clock.Clock, work: DueWork): DueWork {
  return {
    ...work,
    due: (now, most, callsOut) =>
      Effect.map(work.due(now, most, callsOut), (items) =>
        items.map((item) => ({
          ...item,
          perform: (at: number) => Effect.provideService(item.perform(at), Clock.Clock, clock),
        })),
      ),
  };
}

export interface PlaybookCalls {
  readonly call: (operation: PlaybookOperation, input: object, caller?: CallerIdentity) => Promise<Outcome>;
  readonly send: (
    operation: HttpOperation,
    input: object,
    body?: string | Readonly<Uint8Array>,
    caller?: CallerIdentity,
  ) => Promise<Settled<Succeeded>>;
  readonly startChild: (start: ChildStart) => Effect.Effect<ChildStarted>;
  readonly children: () => readonly ChildStart[];
}

interface Operations {
  readonly runDefinition: PlaybookOperation;
}

function bodyOf(body: string | Readonly<Uint8Array> | undefined) {
  if (body === undefined) {
    return {};
  }
  return {
    body: typeof body === 'string' ? contentOfText(body, 'text/csv') : contentOfBytes(body, 'application/octet-stream'),
  };
}

function startedOf(outcome: Outcome): ChildStarted {
  return outcome.status === 'rejected' ? { status: 'rejected', detail: outcome.detail } : { status: outcome.status };
}

export function playbookCalls(ledger: MemoryLedger, { runDefinition }: Operations, clock: Clock.Clock): PlaybookCalls {
  const services = Layer.mergeAll(
    Layer.succeed(Ledger, ledger.service),
    Layer.succeed(Clock.Clock, clock),
    memoryPlaybookRegistry([alpha]),
    recordingReporter().layer,
  );
  const dispatcher = makeDispatcher([]);
  const started: ChildStart[] = [];
  return {
    call: (operation, input, caller = owner) =>
      Effect.runPromise(
        dispatcher
          .dispatchToPlaybook(operation.registration, { caller, ...alpha, input, encoding: 'json' })
          .pipe(Effect.provide(services)),
      ),
    send: (operation, input, body, caller = owner) =>
      Effect.runPromise(
        settle(
          dispatcher.dispatchToPlaybook(operation.registration, {
            caller,
            ...alpha,
            input,
            encoding: 'json',
            ...bodyOf(body),
          }),
        ).pipe(Effect.provide(services)),
      ),
    startChild: (start) =>
      Effect.suspend(() => {
        started.push(start);
        const { caller, type, name, input, runId, lineage, depth, callDepth, calledBy } = start;
        return dispatcher
          .dispatchToPlaybook(runDefinition.registration, {
            caller,
            ...alpha,
            input: { type, name, input, run_id: runId },
            encoding: 'json',
            lineage,
            depth,
            callDepth,
            calledBy,
          })
          .pipe(Effect.provide(services));
      }).pipe(Effect.map(startedOf)),
    children: () => started,
  };
}
