import { makeModelAccess } from '@on.auto/reasoning';
import { scriptedLanguageModel, type ScriptedReplies } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';
import { composedWithTheLedgerOver, type ServedParts } from './served-parts.ts';
import { patientWorkerPool } from './worker-pools.ts';

export interface ReasoningServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly modelCalls: () => number;
  readonly modelRunIds: () => readonly (string | undefined)[];
  readonly stop: () => Promise<void>;
}

export const alpha = '/v1/orgs/acme/playbooks/alpha';

export function loopbackSettingsOver(ledger: TemporaryLedger): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    PREDICTION_CACHE_DIR: ledger.cacheDirectory,
    ...noConsentThroughAuto,
  };
}

type Fetch = typeof globalThis.fetch;

export const noNetwork: Fetch = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

export async function servingReasoning(
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
  fetch: Fetch = noNetwork,
  {
    programPoolOf = patientWorkerPool,
    clock,
    toolTiming,
    ledgerOver,
    admit,
    ledger: shared,
    signers,
  }: ServedParts = {},
): Promise<ReasoningServer> {
  const ledger = shared ?? temporaryLedger();
  const scripted = scriptedLanguageModel(...replies);
  const composition = compositionRootWith(
    (settings) =>
      Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
        ...access,
        languageModel: { ...scripted.languageModel, ...(admit === undefined ? {} : { admit }) },
      })),
    {
      programPoolOf,
      ...(clock === undefined ? {} : { clock }),
      ...(toolTiming === undefined ? {} : { toolTiming }),
      ...(signers === undefined ? {} : { signers }),
    },
  );
  const server = await startServer(
    { ...loopbackSettingsOver(ledger), ...environment },
    ledgerOver === undefined ? composition : composedWithTheLedgerOver(composition, ledgerOver),
  );
  return {
    origin: `http://127.0.0.1:${server.port}`,
    call: (method, path, options) => request(server.port, method, path, options),
    modelCalls: () => scripted.requests().length,
    modelRunIds: () => scripted.requests().map(({ run_id: runId }) => runId),
    stop: async () => {
      await server.stop();
      if (shared === undefined) {
        ledger.remove();
      }
    },
  };
}
