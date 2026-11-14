import {
  Ledger,
  contentHoldersOf,
  makeDispatcher,
  settle,
  type ContentHolders,
  type PlaybookRequest,
  type CallerIdentity,
  type DispatcherServices,
  type Outcome,
  type RecordedPageRequest,
  type RecordedSelection,
  type Runnable,
  type Settled,
} from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  type memoryLedger,
  recordingReporter,
  type MemoryLedger,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

import type { RunMeter } from '../metering/run-meter.ts';
import type { PlaybookOperation } from '../operations/definition-operations.ts';
import { stagedLedgerOf, type ReadModelStaged, type StagedLedger } from '../read-model-testing/staged-ledger.ts';
import { DefinitionEventSchema } from '../registry/definition-events.ts';
import { RunEventSchema } from '../runs/run-events.ts';
import { admittingMeter } from './recording-meter.ts';

export const firstMoment = '2026-10-01T09:00:00.000Z';

export const runContentHolders: ContentHolders = contentHoldersOf([RunEventSchema]);

export const playbookContentHolders: ContentHolders = contentHoldersOf([DefinitionEventSchema, RunEventSchema]);

export type LedgerRead =
  | { readonly loaded: string }
  | { readonly selection: RecordedSelection; readonly page: RecordedPageRequest };

interface PlaybookRoute {
  readonly registration: Runnable<'playbook'>;
}

interface Calling {
  (operation: PlaybookOperation, request: PlaybookRequest, at?: string): Promise<Outcome>;
  (operation: PlaybookRoute, request: PlaybookRequest, at?: string): Promise<Outcome>;
}

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly logged: StagedLedger['logged'];
  readonly ledgerReads: () => readonly LedgerRead[];
  readonly reported: () => readonly ReportedIncident[];
  readonly dispatch: (
    operation: PlaybookOperation,
    request: PlaybookRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>, at?: string) => Promise<A>;
  readonly call: Calling;
  readonly callCancelledWhen: (
    cancelled: Promise<unknown>,
    operation: PlaybookOperation,
    request: PlaybookRequest,
  ) => Promise<Settled>;
}

const knownPlaybooks = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
  { org: 'globex', playbook: 'gamma' },
];

function readsRecordedIn(ledger: Ledger['Service'], recorded: (read: LedgerRead) => void): Ledger['Service'] {
  return Ledger.of({
    ...ledger,
    load: (stream, decider) =>
      Effect.suspend(() => {
        recorded({ loaded: stream });
        return ledger.load(stream, decider);
      }),
    readRecorded: (playbook, selection, page) =>
      Effect.suspend(() => {
        recorded({ selection, page });
        return ledger.readRecorded(playbook, selection, page);
      }),
  });
}

function ledgerReadsOf(ledger: MemoryLedger) {
  const reads: LedgerRead[] = [];
  const service = readsRecordedIn(ledger.service, (read) => {
    reads.push(read);
  });
  return { service, reads: () => reads };
}

export function harness(
  meter: Layer.Layer<RunMeter> | Layer.Layer<never> = admittingMeter,
  store?: Parameters<typeof memoryLedger>[3],
  readModel?: ReadModelStaged,
  definitionNames?: Parameters<typeof stagedLedgerOf>[3],
): Harness {
  const { ledger, staged, logged } = stagedLedgerOf(playbookContentHolders, store, readModel, definitionNames);
  const read = ledgerReadsOf(ledger);
  const recording = recordingReporter();
  const services = Layer.mergeAll(
    Layer.succeed(Ledger, read.service),
    memoryPlaybookRegistry(knownPlaybooks),
    recording.layer,
    TestClock.layer(),
    meter,
    staged,
  );
  const dispatcher = makeDispatcher([]);
  const dispatch: Harness['dispatch'] = (operation, request) =>
    dispatcher.dispatchToPlaybook(operation.registration, request);
  const run: Harness['run'] = (calls, at = firstMoment) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(calls),
        Effect.provide(services),
      ),
    );
  function call(operation: PlaybookOperation, request: PlaybookRequest, at?: string): Promise<Outcome>;
  function call(operation: PlaybookRoute, request: PlaybookRequest, at?: string): Promise<Outcome>;
  function call(operation: PlaybookRoute, request: PlaybookRequest, at?: string): Promise<Outcome> {
    return run(dispatcher.dispatchToPlaybook(operation.registration, request), at);
  }
  return {
    ledger,
    logged,
    ledgerReads: read.reads,
    reported: recording.reported,
    dispatch,
    run,
    call,
    callCancelledWhen: (cancelled, operation, request) => {
      const cancelling = new AbortController();
      void cancelled.then(() => {
        cancelling.abort();
        return cancelling;
      });
      return run(settle(dispatch(operation, request), cancelling.signal));
    },
  };
}

export function toPlaybook(
  org: string,
  playbook: string,
): (caller: CallerIdentity, input?: unknown) => PlaybookRequest {
  return (caller, input = {}) => ({ caller, org, playbook, input, encoding: 'json' });
}

export function asQueryString(request: PlaybookRequest): PlaybookRequest {
  return { ...request, encoding: 'strings' };
}
