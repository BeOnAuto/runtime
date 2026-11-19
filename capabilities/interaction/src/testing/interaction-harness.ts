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
  type WorkLedger,
} from '@on.auto/definitions';
import {
  admittingMeter,
  definitionNamesWith,
  runContentHolders,
  standingClock,
  uncheckedPages,
} from '@on.auto/definitions/testing';
import {
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type ContentHolders,
  type DispatcherServices,
  type KeyedProjection,
  type Ledger,
  type Outcome,
  type PlaybookAddress,
  type PlaybookRequest,
  type Runnable,
} from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedgerWith,
  recordingReporter,
  type MemoryLedger,
  type MemoryLedgerOptions,
} from '@on.auto/operations/testing';
import { Clock, Effect, Layer } from 'effect';

import { makeInteractionFunctionAdapter } from '../capability/interaction-function.ts';
import { openRequests, openRequestsName } from '../requests/open-requests.ts';
import { requestsDue, type DueRequestItem, type RequestsDue } from '../schedule/due-requests.ts';
import { noTools, type ToolPorts } from './fake-tools.ts';
import {
  conversationsDeclared,
  dueInBothLanes,
  firstOpenOf,
  payloadOffloadingOf,
  performedAll,
  performedEach,
  savedAsAnEarlierRelease,
} from './harness-parts.ts';

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const alpha = { org: 'acme', playbook: 'alpha' };

export const beta = { org: 'acme', playbook: 'beta' };

type RequestLedger = Parameters<typeof requestsDue>[0]['ledger'] & WorkLedger;

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
  readonly conversations?: Parameters<typeof conversationsDeclared>[0];
  readonly payloadOffloading?: boolean;
}

interface PlaybookRoute {
  readonly registration: Runnable<'playbook'>;
}

interface LinkedRun {
  readonly type: string;
  readonly name: string;
  readonly input: unknown;
  readonly run_id: string;
}

export type RunLink = Pick<PlaybookRequest, 'lineage' | 'calledBy' | 'trigger'>;

/** Where a call is made: the playbook it is made in, and how the run it starts is linked to the runs before it. */
type CalledAt = PlaybookAddress & RunLink;

interface Calling {
  (operation: PlaybookOperation, input: unknown, caller?: CallerIdentity, at?: CalledAt): Promise<Outcome>;
  (operation: PlaybookRoute, input: unknown, caller?: CallerIdentity, at?: CalledAt): Promise<Outcome>;
}

interface PlaybookCalls {
  readonly define: (name: string, source: string) => Promise<Outcome>;
  readonly defineAsAnEarlierRelease: (name: string, source: string) => Promise<Outcome>;
  readonly ask: (name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly runOf: (runId: string) => Promise<Outcome>;
}

export interface InteractionHarness {
  readonly ledger: HarnessLedger;
  readonly capability: Capability;
  readonly capabilities: readonly Capability[];
  readonly record: RecordWork;
  readonly due: RequestsDue;
  readonly call: Calling;
  readonly define: (name: string, source: string) => Promise<Outcome>;
  readonly defineAsAnEarlierRelease: (name: string, source: string) => Promise<Outcome>;
  readonly ask: (name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly defineAs: (type: string, name: string, source: string) => Promise<Outcome>;
  readonly askAs: (type: string, name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly runLinked: (run: LinkedRun, link: RunLink) => Promise<Outcome>;
  readonly cancel: (runId: string) => Promise<Outcome>;
  readonly runOf: (runId: string) => Promise<Outcome>;
  readonly performDue: (now: number) => Promise<number>;
  readonly firstOpen: () => Promise<unknown>;
  readonly dueOver: (over: RequestLedger) => RequestsDue;
  readonly dueItems: (now: number, due?: RequestsDue) => Promise<readonly DueRequestItem[]>;
  readonly performAll: (items: readonly DueRequestItem[], now: number) => Promise<void>;
  readonly performEach: (times: readonly number[]) => Promise<void>;
  readonly inPlaybook: (at: PlaybookAddress) => PlaybookCalls;
}

function callingIn(services: Layer.Layer<DispatcherServices>): Calling {
  const dispatcher = makeDispatcher([]);
  function call(operation: PlaybookOperation, input: unknown, caller?: CallerIdentity, at?: CalledAt): Promise<Outcome>;
  function call(operation: PlaybookRoute, input: unknown, caller?: CallerIdentity, at?: CalledAt): Promise<Outcome>;
  function call(operation: PlaybookRoute, input: unknown, caller = acmeAdmin, at: CalledAt = alpha): Promise<Outcome> {
    return Effect.runPromise(
      dispatcher
        .dispatchToPlaybook(operation.registration, { caller, ...at, input, encoding: 'json' })
        .pipe(Effect.provide(services)),
    );
  }
  return call;
}

function servicesOf(ledger: HarnessLedger, payloadOffloading: boolean): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(
    ledger.layer,
    payloadOffloadingOf(payloadOffloading),
    memoryPlaybookRegistry([alpha, beta]),
    recordingReporter().layer,
    Layer.succeed(Clock.Clock, standingClock),
    admittingMeter,
  );
}

function savingAnInteraction(call: Calling, capabilities: readonly Capability[]): InteractionHarness['define'] {
  return (name, source) =>
    call(defineCreateDefinition(capabilities, uncheckedPages), { type: 'interaction', name, source, diagram: 'none' });
}

export const namesOfTheTests = definitionNamesWith(['nudging']);

export function ledgerKeepingNames(
  projections: readonly KeyedProjection[],
  holders?: ContentHolders,
  store?: MemoryLedgerOptions['store'],
): MemoryLedger {
  return memoryLedgerWith({
    projections,
    holders,
    ...(store === undefined ? {} : { store }),
    definitionNames: namesOfTheTests,
  });
}

export function ledgerHoldingRuns(projections: readonly KeyedProjection[]): MemoryLedger {
  return ledgerKeepingNames(projections, runContentHolders);
}

function definingIn(call: Calling, capabilities: readonly Capability[], at: CalledAt) {
  return (name: string, source: string) =>
    call(
      defineCreateDefinition(capabilities, uncheckedPages),
      { type: 'interaction', name, source, diagram: 'none' },
      acmeAdmin,
      at,
    );
}

function callsIn(
  call: Calling,
  capability: Capability,
  others: readonly Capability[],
): InteractionHarness['inPlaybook'] {
  const capabilities = [capability, ...others];
  return (at) => ({
    define: definingIn(call, capabilities, at),
    defineAsAnEarlierRelease: definingIn(call, [savedAsAnEarlierRelease(capability), ...others], at),
    ask: (name, input, runId) =>
      call(defineRunDefinition(capabilities), { type: 'interaction', name, input, run_id: runId }, acmeAdmin, at),
    runOf: (runId) => call(defineGetRun(capabilities, uncheckedPages), { run_id: runId }, acmeAdmin, at),
  });
}

export function interactionHarness(options: HarnessOptions = {}): InteractionHarness {
  const ledger: HarnessLedger = options.ledger ?? ledgerHoldingRuns([openRequests]);
  const tools = options.tools ?? noTools;
  const capability = makeInteractionFunctionAdapter({
    tools,
    openRequests: (playbook) =>
      ledger.service.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
    mostOpenRequests: options.mostOpenRequests ?? 10_000,
    conversationsOf: conversationsDeclared(options.conversations),
  });
  const call = callingIn(servicesOf(ledger, options.payloadOffloading ?? false));
  const capabilities = [capability, ...(options.others ?? [])];
  const facts = runFactsOf(declaredFactsOf(capabilities));
  const dueOver = (over: RequestLedger): RequestsDue =>
    requestsDue({ ledger: over, tools, record: workRecorder(over, facts) });
  const due = dueOver(ledger.service);
  const defineAs: InteractionHarness['defineAs'] = (type, name, source) =>
    call(defineCreateDefinition(capabilities, uncheckedPages), { type, name, source });
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
    define: savingAnInteraction(call, capabilities),
    defineAsAnEarlierRelease: savingAnInteraction(call, [savedAsAnEarlierRelease(capability)]),
    ask: (name, input, runId) => askAs('interaction', name, input, runId),
    defineAs,
    askAs,
    runLinked: (run, link) => call(defineRunDefinition(capabilities), run, acmeAdmin, { ...alpha, ...link }),
    cancel: (runId) => call(defineCancelRun(capabilities), { run_id: runId }),
    runOf: (runId) => call(defineGetRun(capabilities, uncheckedPages), { run_id: runId }),
    performDue,
    dueOver,
    dueItems: (now, from = due) => dueInBothLanes(from, now),
    performAll: performedAll,
    performEach: (times) => performedEach(times, performDue),
    firstOpen: () => firstOpenOf(call),
    inPlaybook: callsIn(call, capability, options.others ?? []),
  };
}
