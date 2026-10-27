import {
  Ledger,
  makeDispatcher,
  settle,
  type PlaybookRequest,
  type CallerIdentity,
  type DispatcherServices,
  type Outcome,
  type RecordedPageRequest,
  type RecordedSelection,
  type Runnable,
  type Settled,
  type Succeeded,
} from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedger,
  recordingReporter,
  type MemoryLedger,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

import { runOutcomeMapping, type PlaybookOperation, type RunMeter } from '../index.ts';

export const firstMoment = '2026-10-01T09:00:00.000Z';

export type LedgerRead =
  | { readonly loaded: string }
  | { readonly selection: RecordedSelection; readonly page: RecordedPageRequest };

interface PlaybookRoute {
  readonly registration: Runnable<'playbook'>;
}

interface Calling {
  (operation: PlaybookOperation, request: PlaybookRequest, at?: string): Promise<Outcome>;
  (operation: PlaybookRoute, request: PlaybookRequest, at?: string): Promise<Outcome<Succeeded>>;
}

export interface Harness {
  readonly ledger: MemoryLedger;
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

export function harness(meter?: Layer.Layer<RunMeter>): Harness {
  const ledger = memoryLedger(runOutcomeMapping);
  const reads: LedgerRead[] = [];
  const recording = recordingReporter();
  const services = Layer.mergeAll(
    Layer.succeed(
      Ledger,
      readsRecordedIn(ledger.service, (read) => {
        reads.push(read);
      }),
    ),
    memoryPlaybookRegistry(knownPlaybooks),
    recording.layer,
    TestClock.layer(),
    meter ?? Layer.empty,
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
  function call(operation: PlaybookRoute, request: PlaybookRequest, at?: string): Promise<Outcome<Succeeded>>;
  function call(operation: PlaybookRoute, request: PlaybookRequest, at?: string): Promise<Outcome<Succeeded>> {
    return run(dispatcher.dispatchToPlaybook(operation.registration, request), at);
  }
  return {
    ledger,
    ledgerReads: () => reads,
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
