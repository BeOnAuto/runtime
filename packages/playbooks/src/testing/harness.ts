import {
  makeDispatcher,
  type PlaybookRegistry,
  type PlaybookRequest,
  type CallerIdentity,
  type DispatcherServices,
  type Ledger,
  type OrgRequest,
  type Outcome,
  type Registration,
  type Runnable,
} from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedger,
  recordingReporter,
  type MemoryLedger,
} from '@on.auto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

export const firstMoment = '2026-10-01T09:00:00.000Z';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

interface PlaybookOperation {
  readonly registration: Registration<'playbook'>;
}

interface OrgRoute {
  readonly registration: Runnable<'org'>;
}

interface Calling {
  (operation: OrgOperation, request: OrgRequest, at?: string): Promise<Outcome>;
  (operation: OrgRoute, request: OrgRequest, at?: string): Promise<Outcome>;
}

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly dispatch: (
    operation: OrgOperation,
    request: OrgRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>, at?: string) => Promise<A>;
  readonly call: Calling;
  readonly callInPlaybook: (operation: PlaybookOperation, request: PlaybookRequest, at?: string) => Promise<Outcome>;
}

export function harness(
  playbookRegistry: Layer.Layer<PlaybookRegistry, never, Ledger> = memoryPlaybookRegistry([]),
): Harness {
  const ledger = memoryLedger();
  const services = Layer.mergeAll(
    ledger.layer,
    Layer.provide(playbookRegistry, ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const dispatcher = makeDispatcher([]);
  const dispatch: Harness['dispatch'] = (operation, request) =>
    dispatcher.dispatchToOrg(operation.registration, request);
  const run: Harness['run'] = (calls, at = firstMoment) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(calls),
        Effect.provide(services),
      ),
    );
  function call(operation: OrgOperation, request: OrgRequest, at?: string): Promise<Outcome>;
  function call(operation: OrgRoute, request: OrgRequest, at?: string): Promise<Outcome>;
  function call(operation: OrgRoute, request: OrgRequest, at?: string): Promise<Outcome> {
    return run(dispatcher.dispatchToOrg(operation.registration, request), at);
  }
  return {
    ledger,
    dispatch,
    run,
    call,
    callInPlaybook: (operation, request, at) => run(dispatcher.dispatchToPlaybook(operation.registration, request), at),
  };
}

export function toOrg(org: string): (caller: CallerIdentity, input?: unknown) => OrgRequest {
  return (caller, input = {}) => ({ caller, org, input, encoding: 'json' });
}

export function toPlaybook(
  org: string,
  playbook: string,
): (caller: CallerIdentity, input?: unknown) => PlaybookRequest {
  return (caller, input = {}) => ({ caller, org, playbook, input, encoding: 'json' });
}

export function asQueryString<Request extends OrgRequest | PlaybookRequest>(request: Request): Request {
  return { ...request, encoding: 'strings' };
}
