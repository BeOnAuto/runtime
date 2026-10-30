import { Effect, Layer } from 'effect';

import {
  makeDispatcher,
  settle,
  type PlaybookAddress,
  type PlaybookRequest,
  type CallerIdentity,
  type Dispatcher,
  type DispatcherServices,
  type IncidentReporter,
  type OrgRequest,
  type Outcome,
  type PipelineStep,
  type RunOutcomeMapping,
  type KeyedProjection,
  type Settled,
} from '../index.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';
import { memoryPlaybookRegistry } from './memory-playbook-registry.ts';
import { recordingReporter, type ReportedIncident } from './recording-reporter.ts';

export interface HarnessOptions {
  readonly steps?: readonly PipelineStep[];
  readonly reporter?: Layer.Layer<IncidentReporter>;
  readonly playbooks?: readonly PlaybookAddress[];
  readonly retiredPlaybooks?: readonly PlaybookAddress[];
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly ledger: MemoryLedger;
  readonly reported: () => readonly ReportedIncident[];
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>) => Promise<A>;
  readonly settleWithin: (
    milliseconds: number,
    call: Effect.Effect<Outcome, never, DispatcherServices>,
  ) => Promise<Settled>;
}

const knownPlaybooks: readonly PlaybookAddress[] = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
  { org: 'globex', playbook: 'gamma' },
];

export function harness({
  steps = [],
  reporter,
  playbooks = knownPlaybooks,
  retiredPlaybooks = [],
  runOutcomes,
  projections = [],
}: HarnessOptions = {}): Harness {
  const ledger = memoryLedger(runOutcomes, projections);
  const recording = recordingReporter();
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry(playbooks, retiredPlaybooks),
    reporter ?? recording.layer,
  );
  const run = <A>(calls: Effect.Effect<A, never, DispatcherServices>) =>
    Effect.runPromise(calls.pipe(Effect.provide(services)));
  return {
    dispatcher: makeDispatcher(steps),
    ledger,
    reported: recording.reported,
    run,
    settleWithin: (milliseconds, call) => run(settle(call, AbortSignal.timeout(milliseconds))),
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
