import { makeModelAccess } from '@on.auto/reasoning';
import { scriptedLanguageModel, type ScriptedReplies } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { requestThrough, type Answering, type RequestOptions, type TestResponse } from './http-client.ts';
import { composedWithTheParts, offloadingSetBy, type ServedParts } from './served-parts.ts';
import { startedOver } from './started-servers.ts';
import { patientWorkerPool } from './worker-pools.ts';

export { loopbackSettingsOver } from './started-servers.ts';

export interface ReasoningServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly modelCalls: () => number;
  readonly modelRunIds: () => readonly (string | undefined)[];
  readonly stop: () => Promise<void>;
}

export function alphaIn(org: string): string {
  return `/v1/orgs/${org}/playbooks/alpha`;
}

export const alpha = alphaIn('acme');

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

export async function servingReasoning(
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
  fetch: Fetch = noNetwork,
  {
    programPoolOf = patientWorkerPool,
    ledgerOver,
    admit,
    ledger: shared,
    meter,
    shippedFilesOver,
    keptOutside,
    key,
    over,
    ...composing
  }: ServedParts = {},
): Promise<ReasoningServer> {
  const scripted = scriptedLanguageModel(...replies);
  const composition = compositionRootWith(
    (settings) =>
      Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
        ...access,
        languageModel: { ...scripted.languageModel, ...(admit === undefined ? {} : { admit }) },
      })),
    { programPoolOf, ...composing },
  );
  const composed = composedWithTheParts(composition, { ledgerOver, meter, shippedFilesOver });
  const server = await startedOver(over, { ...offloadingSetBy(keptOutside), ...environment }, composed, shared);
  return {
    ...(await callsAt(server, key)),
    modelCalls: () => scripted.requests().length,
    modelRunIds: () => scripted.requests().map(({ run_id: runId }) => runId),
    stop: server.stop,
  };
}
