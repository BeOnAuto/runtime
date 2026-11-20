import { makeModelAccess } from '@on.auto/reasoning';
import { scriptedLanguageModel, type ScriptedReplies } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';
import { composedWithTheParts, offloadingSetBy, type ServedParts } from './served-parts.ts';
import { patientWorkerPool } from './worker-pools.ts';

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

export function loopbackSettingsOver(ledger: TemporaryLedger): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    ...noConsentThroughAuto,
  };
}

type Fetch = typeof globalThis.fetch;

export const noNetwork: Fetch = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

async function startedRemovingOnFailure<Started>(start: Promise<Started>, removeOwn: () => void): Promise<Started> {
  try {
    return await start;
  } catch (failure) {
    removeOwn();
    throw failure;
  }
}

async function callsAt(port: number, key: ServedParts['key']): Promise<Pick<ReasoningServer, 'origin' | 'call'>> {
  const origin = `http://127.0.0.1:${port}`;
  const given = typeof key === 'function' ? await key(origin) : key;
  return {
    origin,
    call: (method, path, options) =>
      request(port, method, path, given === undefined ? options : { key: given, ...options }),
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
    ...composing
  }: ServedParts = {},
): Promise<ReasoningServer> {
  const ledger = shared ?? temporaryLedger();
  const removeOwn = (): void => {
    if (shared === undefined) {
      ledger.remove();
    }
  };
  const scripted = scriptedLanguageModel(...replies);
  const composition = compositionRootWith(
    (settings) =>
      Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
        ...access,
        languageModel: { ...scripted.languageModel, ...(admit === undefined ? {} : { admit }) },
      })),
    { programPoolOf, ...composing },
  );
  const server = await startedRemovingOnFailure(
    startServer(
      { ...loopbackSettingsOver(ledger), ...offloadingSetBy(keptOutside), ...environment },
      composedWithTheParts(composition, { ledgerOver, meter, shippedFilesOver }),
    ),
    removeOwn,
  );
  return {
    ...(await callsAt(server.port, key)),
    modelCalls: () => scripted.requests().length,
    modelRunIds: () => scripted.requests().map(({ run_id: runId }) => runId),
    stop: async () => {
      await server.stop();
      removeOwn();
    },
  };
}
