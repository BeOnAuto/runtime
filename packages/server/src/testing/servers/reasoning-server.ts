import { makeModelAccess } from '@on.auto/reasoning';
import { scriptedLanguageModel, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';
import type { ServedParts } from './served-parts.ts';
import { patientWorkerPool } from './worker-pools.ts';

export interface ReasoningServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly modelCalls: () => number;
  readonly modelRunIds: () => readonly (string | undefined)[];
  readonly stop: () => Promise<void>;
}

export const alpha = '/v1/orgs/acme/playbooks/alpha';

type Fetch = typeof globalThis.fetch;

export const noNetwork: Fetch = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

export async function servingReasoning(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = {},
  fetch: Fetch = noNetwork,
  { programPoolOf = patientWorkerPool, clock, toolTiming }: ServedParts = {},
): Promise<ReasoningServer> {
  const ledger = temporaryLedger();
  const scripted = scriptedLanguageModel(...replies);
  const server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      AUTO_CLIENTS: 'false',
      ...environment,
    },
    compositionRootWith(
      (settings) =>
        Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
          ...access,
          languageModel: scripted.languageModel,
        })),
      programPoolOf,
      clock,
      toolTiming,
    ),
  );
  return {
    origin: `http://127.0.0.1:${server.port}`,
    call: (method, path, options) => request(server.port, method, path, options),
    modelCalls: () => scripted.requests().length,
    modelRunIds: () => scripted.requests().map(({ run_id: runId }) => runId),
    stop: async () => {
      await server.stop();
      ledger.remove();
    },
  };
}
