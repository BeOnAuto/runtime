import type { FetchLike } from '@modelcontextprotocol/client';
import { unreadDocuments, type DocumentReading } from '@on.auto/documents';
import { Result } from 'effect';

import { unobserved, type CallSettled, type ServedClient } from '../clients/server-client.ts';
import { isCredentialRefused } from '../clients/server-failures.ts';
import type { TokenSource } from '../clients/token-source.ts';
import { settledOf, type Answering } from './api-answers.ts';
import { apiRequestOf, isUnderBase, type ApiEndpoint, type ApiRequest } from './api-requests.ts';
import { ArgumentsRefused } from './arguments-refused.ts';
import type { DescribedApiSettings } from './described-api.ts';

export interface ApiOpening {
  readonly fetch: FetchLike;
  readonly tokens: TokenSource | undefined;
  readonly now: () => number;
  readonly documents?: DocumentReading | undefined;
}

class AddressOutsideBase extends Error {
  constructor() {
    super('The bridge built an address outside base_url for this call, a defect of the runtime, and sent nothing');
  }
}

async function authorizationOf(tokens: TokenSource | undefined): Promise<Readonly<Record<string, string>>> {
  return tokens === undefined ? {} : { authorization: `Bearer ${await tokens.token()}` };
}

interface Sending {
  readonly endpoint: ApiEndpoint;
  readonly opening: ApiOpening;
  readonly signal: Readonly<AbortSignal>;
  readonly settle: (response: Readonly<Response>) => Promise<CallSettled>;
}

function refusesTheCredential(settled: CallSettled): boolean {
  return 'error' in settled && isCredentialRefused(settled.error);
}

async function settledCall(request: ApiRequest, sending: Sending, mintedAgain = false): Promise<CallSettled> {
  const { endpoint, opening, signal, settle } = sending;
  const tokens = request.usesToken ? opening.tokens : undefined;
  const response = await opening.fetch(request.url, {
    method: request.method,
    headers: { ...request.headers, ...(await authorizationOf(tokens)) },
    body: request.body,
    redirect: 'manual',
    signal,
  });
  const settled = await settle(response);
  if (tokens === undefined || mintedAgain || !refusesTheCredential(settled)) {
    return settled;
  }
  await tokens.onUnauthorized({ response, serverUrl: new URL(endpoint.baseUrl), fetchFn: opening.fetch });
  return settledCall(request, sending, true);
}

function listingOf({ operations }: DescribedApiSettings['api']): ServedClient['listTools'] {
  return () =>
    Promise.resolve(
      operations.map(({ tool, answers }) => (answers.describesNoBody ? { ...tool, answersNoBody: true } : tool)),
    );
}

function answeringOf(settings: DescribedApiSettings, { now }: ApiOpening): Answering {
  return { requestIdHeader: settings.request_id, failureCodes: settings.failure_codes, now };
}

interface Reading {
  readonly started: number;
  readonly timeoutMs: number;
  readonly signal: Readonly<AbortSignal>;
}

function fileOf(named: string | undefined, { documents = unreadDocuments }: ApiOpening, reading: Reading) {
  const { started, timeoutMs, signal } = reading;
  return {
    named,
    read: (given: Parameters<DocumentReading>[0], textBytes: number) =>
      documents(given, { deadlineMs: timeoutMs - (performance.now() - started), textBytes, signal }),
  };
}

export function apiClient(settings: DescribedApiSettings, opening: ApiOpening): ServedClient {
  const operations = new Map(settings.api.operations.map((operation) => [operation.tool.name, operation]));
  const endpoint: ApiEndpoint = {
    baseUrl: settings.api.baseUrl,
    headers: settings.headers,
    query: settings.query_params,
  };
  const answering = answeringOf(settings, opening);
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  return {
    call: async ({ tool, input, signal, timeoutMs }) => {
      const started = performance.now();
      const operation = operations.get(tool);
      if (operation === undefined) {
        return { error: new ArgumentsRefused(`The tool server lists no tool ${tool}`), observed: unobserved };
      }
      const request = apiRequestOf(operation, input, endpoint);
      if (Result.isFailure(request)) {
        return { error: new ArgumentsRefused(request.failure), observed: unobserved };
      }
      if (!isUnderBase(endpoint.baseUrl, request.success.url)) {
        return { error: new AddressOutsideBase(), observed: unobserved };
      }
      const file = fileOf(request.success.named, opening, { started, timeoutMs, signal });
      try {
        return await settledCall(request.success, {
          endpoint,
          opening,
          signal,
          settle: (response) => settledOf(response, answering, operation.answers, file),
        });
      } catch (error) {
        return { error, observed: unobserved };
      }
    },
    listTools: listingOf(settings.api),
    closed,
    end: () => {
      resolve();
      return closed;
    },
  };
}
