import type { FetchLike } from '@modelcontextprotocol/client';
import { unreadDocuments, type DocumentReading } from '@on.auto/documents';
import { Result } from 'effect';

import type { Observed } from '../clients/observed-requests.ts';
import type { ServerClient } from '../clients/server-client.ts';
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

const unobserved: Observed = { id: null, response: null };

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
}

async function sent(request: ApiRequest, sending: Sending, mintedAgain = false): Promise<Response> {
  const { endpoint, opening, signal } = sending;
  const tokens = request.usesToken ? opening.tokens : undefined;
  const response = await opening.fetch(request.url, {
    method: request.method,
    headers: { ...request.headers, ...(await authorizationOf(tokens)) },
    body: request.body,
    redirect: 'manual',
    signal,
  });
  if (response.status !== 401 || tokens === undefined || mintedAgain) {
    return response;
  }
  await response.body?.cancel();
  await tokens.onUnauthorized({ response, serverUrl: new URL(endpoint.baseUrl), fetchFn: opening.fetch });
  return sent(request, sending, true);
}

export function apiClient(settings: DescribedApiSettings, opening: ApiOpening): ServerClient {
  const operations = new Map(settings.api.operations.map((operation) => [operation.tool.name, operation]));
  const endpoint: ApiEndpoint = {
    baseUrl: settings.api.baseUrl,
    headers: settings.headers,
    query: settings.query_params,
  };
  const answering: Answering = { requestIdHeader: settings.request_id, now: opening.now };
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
      try {
        return await settledOf(
          await sent(request.success, { endpoint, opening, signal }),
          answering,
          operation.answers,
          {
            named: request.success.named,
            read: (given, textBytes) =>
              (opening.documents ?? unreadDocuments)(given, {
                deadlineMs: timeoutMs - (performance.now() - started),
                textBytes,
                signal,
              }),
          },
        );
      } catch (error) {
        return { error, observed: unobserved };
      }
    },
    listTools: () => Promise.resolve(settings.api.operations.map(({ tool }) => tool)),
    closed,
    end: () => {
      resolve();
      return closed;
    },
  };
}
