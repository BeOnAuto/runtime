import { unreadDocuments, type DocumentReading } from '@on.auto/documents';
import type { CallMeta, FetchOfACall } from '@on.auto/operations';
import { Result } from 'effect';

import { unobserved, type CallSettled, type ServedClient } from '../clients/server-client.ts';
import { isCredentialRefused } from '../clients/server-failures.ts';
import type { TokenSource, UnauthorizedContext } from '../clients/token-source.ts';
import { settledOf, type Answering } from './api-answers.ts';
import { apiRequestOf, isUnderBase, sentBodyOf, type ApiEndpoint, type ApiRequest } from './api-requests.ts';
import { ArgumentsRefused } from './arguments-refused.ts';
import type { DescribedApiSettings } from './described-api.ts';

export interface ApiOpening {
  readonly fetch: FetchOfACall;
  readonly tokens: TokenSource | undefined;
  readonly now: () => number;
  readonly documents?: DocumentReading | undefined;
}

class AddressOutsideBase extends Error {
  constructor() {
    super('The bridge built an address outside base_url for this call, a defect of the runtime, and sent nothing');
  }
}

type Authorization = Readonly<Record<string, string>>;

async function authorizationOf(tokens: TokenSource | undefined): Promise<Authorization> {
  return tokens === undefined ? {} : { authorization: `Bearer ${await tokens.token()}` };
}

interface Sending {
  readonly endpoint: ApiEndpoint;
  readonly meta: CallMeta;
  readonly opening: ApiOpening;
  readonly signal: Readonly<AbortSignal>;
  readonly settle: (response: Readonly<Response>) => Promise<CallSettled>;
}

function refusesTheCredential(settled: CallSettled): boolean {
  return 'error' in settled && isCredentialRefused(settled.error);
}

interface SentWith<Settled> {
  readonly response: Readonly<Response>;
  readonly settled: Settled;
}

export async function settledWithOneNewToken<Settled>(
  tokens: TokenSource | undefined,
  sentWith: (authorization: Authorization) => Promise<SentWith<Settled>>,
  refuses: (settled: Settled) => boolean,
  refusedAt: Omit<UnauthorizedContext, 'response'>,
): Promise<Settled> {
  const { response, settled } = await sentWith(await authorizationOf(tokens));
  if (tokens === undefined || !refuses(settled)) {
    return settled;
  }
  await tokens.onUnauthorized({ ...refusedAt, response });
  return (await sentWith(await authorizationOf(tokens))).settled;
}

function settledCall(request: ApiRequest, sending: Sending): Promise<CallSettled> {
  const { endpoint, meta, opening, signal, settle } = sending;
  return settledWithOneNewToken(
    request.usesToken ? opening.tokens : undefined,
    async (authorization) => {
      const response = await opening.fetch(
        request.url,
        {
          method: request.method,
          ...sentBodyOf(request, { ...request.headers, ...authorization }),
          redirect: 'manual',
          signal,
        },
        meta,
      );
      return { response, settled: await settle(response) };
    },
    refusesTheCredential,
    { serverUrl: new URL(endpoint.baseUrl), fetchFn: opening.fetch },
  );
}

function listingOf({ operations }: DescribedApiSettings['api']): ServedClient['listTools'] {
  return () =>
    Promise.resolve(
      operations.map(({ tool, answers }) => (answers.describesNoBody ? { ...tool, answersNoBody: true } : tool)),
    );
}

function answeringOf(settings: DescribedApiSettings, { now }: ApiOpening): Omit<Answering, 'input' | 'assets'> {
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
    call: async ({ tool, input, assets = [], meta, signal, timeoutMs }) => {
      const started = performance.now();
      const operation = operations.get(tool);
      if (operation === undefined) {
        return { error: new ArgumentsRefused(`The tool server lists no tool ${tool}`), observed: unobserved };
      }
      const request = apiRequestOf(operation, input, endpoint, assets);
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
          meta,
          opening,
          signal,
          settle: (response) => settledOf(response, { ...answering, input, assets }, operation.answers, file),
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
