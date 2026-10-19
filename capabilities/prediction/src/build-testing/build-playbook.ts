import {
  composedFactsOf,
  deferredCanceller,
  defineCancelRun,
  defineCreateDefinition,
  defineGetDefinition,
  defineGetRun,
  defineRetireDefinition,
  defineRunDefinition,
  defineUpdateDefinition,
  runFactsOf,
  workRecorder,
  type Capability,
  type PlaybookOperation,
} from '@on.auto/definitions';
import { standingClock } from '@on.auto/definitions/testing';
import {
  defineAnswerInteraction,
  listInteractions,
  makeInteractionFunctionAdapter,
  openRequests,
  requestsDue,
} from '@on.auto/interaction';
import { noTools } from '@on.auto/interaction/testing';
import { Clock, Effect } from 'effect';

import { buildsDue } from '../builds/builds-due.ts';
import { makePredictionFunctionAdapter } from '../capability/prediction-function.ts';
import { testPorts, type PortOptions, type TestPorts } from '../testing/prediction-ports.ts';
import { poolOf } from '../testing/prediction-runs.ts';
import { performedOn, playbookCalls, type PlaybookCalls, type PlaybookDue } from './playbook-calls.ts';

interface PlaybookOperations {
  readonly create: PlaybookOperation;
  readonly run: PlaybookOperation;
  readonly get: PlaybookOperation;
  readonly getRun: PlaybookOperation;
  readonly cancel: PlaybookOperation;
  readonly answer: PlaybookOperation;
  readonly retire: PlaybookOperation;
  readonly update: PlaybookOperation;
  readonly interactions: PlaybookOperation;
}

export interface BuildPlaybook extends PlaybookCalls {
  readonly test: TestPorts;
  readonly prediction: Capability;
  readonly operations: PlaybookOperations;
  readonly due: PlaybookDue;
  readonly now: () => number;
  readonly cancelled: (id: string) => ReturnType<PlaybookCalls['call']>;
}

interface BuildPlaybookOptions extends PortOptions {
  readonly clock?: Clock.Clock;
}

export function buildPlaybook({ clock = standingClock, ...options }: BuildPlaybookOptions = {}): BuildPlaybook {
  const test = testPorts({ ...options, projections: [openRequests] });
  const { ports, ledger } = test;
  const prediction = makePredictionFunctionAdapter({
    pool: poolOf(),
    datasets: { datasetOf: () => Effect.undefined },
    ports,
  });
  const interaction = makeInteractionFunctionAdapter({
    tools: noTools,
    openRequests: () => Effect.succeed(0),
    mostOpenRequests: 64,
  });
  const capabilities = [prediction, interaction];
  const operations: PlaybookOperations = {
    create: defineCreateDefinition(capabilities),
    run: defineRunDefinition(capabilities),
    get: defineGetDefinition(capabilities),
    getRun: defineGetRun(capabilities),
    cancel: defineCancelRun(capabilities),
    answer: defineAnswerInteraction(capabilities),
    retire: defineRetireDefinition(capabilities),
    update: defineUpdateDefinition(capabilities),
    interactions: listInteractions,
  };
  const calls = playbookCalls(ledger, { runDefinition: operations.run }, clock);
  const record = workRecorder(ledger.service, runFactsOf(composedFactsOf(capabilities).onRuns));
  const due: PlaybookDue = [
    buildsDue({ ports, runs: calls.startChild }),
    requestsDue({ ledger: ledger.service, tools: noTools, record }),
  ].map((work) => performedOn(clock, work));
  const cancelled = async (id: string) => {
    const asked = await calls.call(operations.cancel, { run_id: id });
    await Effect.runPromise(
      deferredCanceller(capabilities, ledger.service)(
        { org: 'acme', playbook: 'alpha', id },
        { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        { causationId: null, correlationId: id },
      ).pipe(Effect.provideService(Clock.Clock, clock)),
    );
    return asked;
  };
  return { ...calls, test, prediction, operations, due, now: () => clock.currentTimeMillisUnsafe(), cancelled };
}
