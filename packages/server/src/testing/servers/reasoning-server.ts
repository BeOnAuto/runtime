import { makeModelAccess, type ModelRequest } from '@on.auto/reasoning';
import { scriptedLanguageModel, type ScriptedReplies } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';

import { heardFrom, sleepsTold, somethingHappened } from '../waiting/happenings.ts';
import { statementsInHand, steppedServerClock, type SteppedServerClock } from '../waiting/stepped-server-clock.ts';
export { testServersStartAt } from '../waiting/stepped-server-clock.ts';
import { requestThrough, type Answering, type RequestOptions, type TestResponse } from './http-client.ts';
import { compositionOfATestServer } from './prepared-parts.ts';
import { composedOnTheClock, composedWithTheParts, offloadingSetBy, type ServedParts } from './served-parts.ts';
import { startedOver, type StartedServer } from './started-servers.ts';
import { patientThreadPool } from './worker-pools.ts';

export { loopbackSettingsOver } from './started-servers.ts';

export interface ReasoningServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly modelCalls: () => number;
  readonly modelRunIds: () => readonly (string | undefined)[];
  /** The requests the scripted model was asked, in order. */
  readonly modelRequests: () => readonly ModelRequest[];
  readonly stop: () => Promise<void>;
  /** The requests the server answered, in order, 499 where its client had gone before the answer. */
  readonly answered: StartedServer['answered'];
  /** The requests that reached the server, in order. */
  readonly arrived: StartedServer['arrived'];
  /** The stepped clock of the server's own, unless its test gave it a clock: the test then moves that one. */
  readonly clock?: SteppedServerClock;
  /** The stepped clock the server runs on, its own or the one its test gave it. */
  readonly runsOn: SteppedServerClock;
}

type ServerClock = NonNullable<ServedParts['clock']>;

export function alphaIn(org: string): string {
  return `/v1/orgs/${org}/playbooks/alpha`;
}

export const alpha = alphaIn('acme');

/** The server's calls, its clock moved on a millisecond before each, so that each is stamped after the one before. */
export function aMomentApart(server: Pick<ReasoningServer, 'call' | 'runsOn'>): ReasoningServer['call'] {
  return (method, path, options) => {
    server.runsOn.moveTo(server.runsOn.now() + 1);
    return server.call(method, path, options);
  };
}

type Fetch = typeof globalThis.fetch;

export const noNetwork: Fetch = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

async function callsAt(
  answering: Answering,
  key: ServedParts['key'],
): Promise<Pick<ReasoningServer, 'origin' | 'call'>> {
  const given = typeof key === 'function' ? await key(answering.origin) : key;
  return {
    origin: answering.origin,
    call: (method, path, options) =>
      requestThrough(answering, method, path, given === undefined ? options : { key: given, ...options }),
  };
}

type ScriptedModel = ReturnType<typeof scriptedLanguageModel>['languageModel'];

/**
 * The scripted model, telling the waiting tests of each call once it has counted it, whether it answers or never does:
 * the telling waits one turn, in a fiber of its own, while the call is counted.
 */
function toldOfModelCalls(model: ScriptedModel): ScriptedModel {
  return {
    ...model,
    generate: (request) =>
      Effect.andThen(
        Effect.forkChild(Effect.andThen(Effect.yieldNow, Effect.sync(somethingHappened))),
        model.generate(request),
      ),
  };
}

/** A stepped clock of the server's own, which moves only when its test moves it, unless its test gave it a clock. */
function clockOf(given: ServedParts): ServerClock {
  return given.clock ?? steppedServerClock();
}

/** The ledger a test gave over, if any, each statement of it in hand on the server's clock while it runs. */
function countedOver(
  clock: ServerClock,
  ledgerOver: ServedParts['ledgerOver'],
): NonNullable<ServedParts['ledgerOver']> {
  return (ledger) => statementsInHand(clock.inHand, ledgerOver === undefined ? ledger : ledgerOver(ledger));
}

/** The models the server reaches, its language model the scripted one, admitting as the test says where it says. */
function scriptedAccess(
  fetch: Fetch,
  generating: ScriptedModel,
  admit: ServedParts['admit'],
): Parameters<typeof compositionOfATestServer>[0] {
  return (settings) =>
    Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
      ...access,
      languageModel: { ...generating, ...(admit === undefined ? {} : { admit }) },
    }));
}

function modelCallsOf(
  requests: () => readonly ModelRequest[],
): Pick<ReasoningServer, 'modelCalls' | 'modelRunIds' | 'modelRequests'> {
  return {
    modelCalls: () => requests().length,
    modelRunIds: () => requests().map(({ run_id: runId }) => runId),
    modelRequests: requests,
  };
}

export async function servingReasoning(
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
  fetch: Fetch = noNetwork,
  {
    programPoolOf = patientThreadPool,
    ledgerOver,
    admit,
    ledger: shared,
    meter,
    shippedFilesOver,
    keptOutside,
    key,
    over,
    preparingItself,
    ...given
  }: ServedParts = {},
): Promise<ReasoningServer> {
  const clock = clockOf(given);
  const scripted = scriptedLanguageModel(...replies);
  const generating = toldOfModelCalls(scripted.languageModel);
  const composition = compositionOfATestServer(
    scriptedAccess(fetch, generating, admit),
    { programPoolOf, ...given, clock: sleepsTold(clock) },
    preparingItself,
  );
  const composed = composedWithTheParts(composedOnTheClock(composition, clock.now), {
    ledgerOver: countedOver(clock, ledgerOver),
    meter,
    shippedFilesOver,
  });
  const server = await startedOver(over, { ...offloadingSetBy(keptOutside), ...environment }, composed, {
    shared,
    inHand: clock.inHand,
  });
  const unheard = heardFrom({ atRest: clock.atRest, busy: clock.inHand.busy });
  return {
    ...(await callsAt(server, key)),
    ...modelCallsOf(scripted.requests),
    stop: async () => {
      unheard();
      await server.stop();
    },
    answered: server.answered,
    arrived: server.arrived,
    ...(given.clock === undefined ? { clock } : {}),
    runsOn: clock,
  };
}

/** The documents of answers read in this process, for a test that is not about the processes that read them. */
export { documentsReadInProcess } from '@on.auto/documents/testing';
