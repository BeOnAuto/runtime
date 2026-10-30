import {
  declaredFactsOf,
  defineCancelRun,
  defineCreateDefinition,
  defineRunDefinition,
  defineGetRun,
  runFactsOf,
  workRecorder,
  type PlaybookOperation,
  type Capability,
  type RecordWork,
} from '@on.auto/definitions';
import { standingClock, admittingMeter } from '@on.auto/definitions/testing';
import {
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type DispatcherServices,
  type Ledger,
  type Outcome,
  type Runnable,
} from '@on.auto/operations';
import { memoryPlaybookRegistry, memoryLedger, recordingReporter } from '@on.auto/operations/testing';
import { Clock, Effect, Layer } from 'effect';

import { makeInteractionFunctionAdapter } from '../capability/interaction-function.ts';
import { openRequests, openRequestsName } from '../requests/open-requests.ts';
import { requestsDue, type DueRequestItem, type RequestsDue } from '../schedule/due-requests.ts';
import { noTools, type ToolPorts } from './fake-tools.ts';
import { dueInBothLanes, firstOpenOf, performedAll, performedEach } from './harness-parts.ts';

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const alpha = { org: 'acme', playbook: 'alpha' };

type RequestLedger = Parameters<typeof requestsDue>[0]['ledger'];

export interface HarnessLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
}

export type HarnessTools = ToolPorts;

export interface HarnessOptions {
  readonly ledger?: HarnessLedger | undefined;
  readonly tools?: HarnessTools;
  readonly mostOpenRequests?: number;
  readonly others?: readonly Capability[];
}

interface PlaybookRoute {
  readonly registration: Runnable<'playbook'>;
}

interface Calling {
  (operation: PlaybookOperation, input: unknown, caller?: CallerIdentity): Promise<Outcome>;
  (operation: PlaybookRoute, input: unknown, caller?: CallerIdentity): Promise<Outcome>;
}

export interface InteractionHarness {
  readonly ledger: HarnessLedger;
  readonly capability: Capability;
  readonly capabilities: readonly Capability[];
  readonly record: RecordWork;
  readonly due: RequestsDue;
  readonly call: Calling;
  readonly define: (name: string, source: string) => Promise<Outcome>;
  readonly ask: (name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly defineAs: (type: string, name: string, source: string) => Promise<Outcome>;
  readonly askAs: (type: string, name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly cancel: (runId: string) => Promise<Outcome>;
  readonly runOf: (runId: string) => Promise<Outcome>;
  readonly performDue: (now: number) => Promise<number>;
  readonly firstOpen: () => Promise<unknown>;
  readonly dueOver: (over: RequestLedger) => RequestsDue;
  readonly dueItems: (now: number, due?: RequestsDue) => Promise<readonly DueRequestItem[]>;
  readonly performAll: (items: readonly DueRequestItem[], now: number) => Promise<void>;
  readonly performEach: (times: readonly number[]) => Promise<void>;
}

function callingIn(services: Layer.Layer<DispatcherServices>): Calling {
  const dispatcher = makeDispatcher([]);
  function call(operation: PlaybookOperation, input: unknown, caller?: CallerIdentity): Promise<Outcome>;
  function call(operation: PlaybookRoute, input: unknown, caller?: CallerIdentity): Promise<Outcome>;
  function call(operation: PlaybookRoute, input: unknown, caller = acmeAdmin): Promise<Outcome> {
    return Effect.runPromise(
      dispatcher
        .dispatchToPlaybook(operation.registration, { caller, ...alpha, input, encoding: 'json' })
        .pipe(Effect.provide(services)),
    );
  }
  return call;
}

function servicesOf(ledger: HarnessLedger): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([alpha]),
    recordingReporter().layer,
    Layer.succeed(Clock.Clock, standingClock),
    admittingMeter,
  );
}

export function interactionHarness(options: HarnessOptions = {}): InteractionHarness {
  const ledger: HarnessLedger = options.ledger ?? memoryLedger(undefined, [openRequests]);
  const tools = options.tools ?? noTools;
  const capability = makeInteractionFunctionAdapter({
    tools,
    openRequests: (playbook) =>
      ledger.service.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
    mostOpenRequests: options.mostOpenRequests ?? 10_000,
  });
  const call = callingIn(servicesOf(ledger));
  const capabilities = [capability, ...(options.others ?? [])];
  const facts = runFactsOf(declaredFactsOf(capabilities));
  const dueOver = (over: RequestLedger): RequestsDue =>
    requestsDue({ ledger: over, tools, record: workRecorder(over, facts) });
  const due = dueOver(ledger.service);
  const defineAs: InteractionHarness['defineAs'] = (type, name, source) =>
    call(defineCreateDefinition(capabilities), { type, name, source });
  const askAs: InteractionHarness['askAs'] = (type, name, input, runId) =>
    call(defineRunDefinition(capabilities), { type, name, input, run_id: runId });
  const performDue = async (now: number): Promise<number> => {
    const items = await dueInBothLanes(due, now);
    await performedAll(items, now);
    return items.length;
  };
  return {
    ledger,
    capability,
    capabilities,
    record: workRecorder(ledger.service, facts),
    due,
    call,
    define: (name, source) => defineAs('interaction', name, source),
    ask: (name, input, runId) => askAs('interaction', name, input, runId),
    defineAs,
    askAs,
    cancel: (runId) => call(defineCancelRun(capabilities), { run_id: runId }),
    runOf: (runId) => call(defineGetRun(capabilities), { run_id: runId }),
    performDue,
    dueOver,
    dueItems: (now, from = due) => dueInBothLanes(from, now),
    performAll: performedAll,
    performEach: (times) => performedEach(times, performDue),
    firstOpen: () => firstOpenOf(call),
  };
}
