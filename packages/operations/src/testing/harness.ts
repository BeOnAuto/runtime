import { Effect, Layer } from 'effect';

import type { DispatcherOptions } from '../authorization/admitted-calls.ts';
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
  type PolicyDecisionPoint,
  type RunOutcomeMapping,
  type KeyedProjection,
  type Settled,
} from '../index.ts';
import { definitionsNamedByTheirIds } from '../projections-testing/definition-rows-behaviour.ts';
import { memoryLedgerWith, type MemoryLedger } from './memory-ledger.ts';
import { memoryPlaybookRegistry } from './memory-playbook-registry.ts';
import { recordingReporter, type ReportedIncident } from './recording-reporter.ts';

export interface HarnessOptions {
  readonly steps?: readonly PipelineStep[];
  readonly reporter?: Layer.Layer<IncidentReporter>;
  readonly playbooks?: readonly PlaybookAddress[];
  readonly retiredPlaybooks?: readonly PlaybookAddress[];
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly reportOnly?: PolicyDecisionPoint;
  readonly decidedBy?: PolicyDecisionPoint;
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly ledger: MemoryLedger;
  readonly reported: () => readonly ReportedIncident[];
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>) => Promise<A>;
  readonly settleAbortedWhileItRuns: (call: Effect.Effect<Outcome, never, DispatcherServices>) => Promise<Settled>;
}

const knownPlaybooks: readonly PlaybookAddress[] = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
  { org: 'globex', playbook: 'gamma' },
];

function dispatcherOptionsOf({ reportOnly, decidedBy }: HarnessOptions): DispatcherOptions {
  if (decidedBy !== undefined) {
    return { decidedBy };
  }
  return reportOnly === undefined ? {} : { reportOnly };
}

export function harness(options: HarnessOptions = {}): Harness {
  const {
    steps = [],
    reporter,
    playbooks = knownPlaybooks,
    retiredPlaybooks = [],
    runOutcomes,
    projections = [],
  } = options;
  const ledger = memoryLedgerWith({ runOutcomes, projections, definitionNames: definitionsNamedByTheirIds });
  const recording = recordingReporter();
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry(playbooks, retiredPlaybooks),
    reporter ?? recording.layer,
  );
  const run = <A>(calls: Effect.Effect<A, never, DispatcherServices>) =>
    Effect.runPromise(calls.pipe(Effect.provide(services)));
  return {
    dispatcher: makeDispatcher(steps, dispatcherOptionsOf(options)),
    ledger,
    reported: recording.reported,
    run,
    settleAbortedWhileItRuns: (call) => {
      const aborting = new AbortController();
      setImmediate(() => {
        aborting.abort();
      });
      return run(settle(call, aborting.signal));
    },
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
