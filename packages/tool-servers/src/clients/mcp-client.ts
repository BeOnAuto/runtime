import { Client } from '@modelcontextprotocol/client';
import { Predicate } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { decodeListedTools, decodeToolResult, type ToolResult } from '../bounds/tool-results.ts';
import { observations, type Observations } from './observed-requests.ts';
import type { ServerClient } from './server-client.ts';

export type TraceMeta = () => Readonly<Record<string, string>>;

interface ToolClient {
  readonly request: Client['request'];
  readonly listTools: Client['listTools'];
}

export interface OpenedClient {
  readonly client: Client;
  readonly observations: Observations;
  readonly closed: Promise<void>;
}

export interface OutputReport {
  readonly scrub: (text: string) => string;
  readonly report: (line: string) => void;
}

const mostReportedLines = 100;

const mostReportedCharacters = 2000;

export const errorsNoLongerReported = 'The MCP server caused more errors than are reported; the rest is not shown';

export function boundedReport({ scrub, report }: OutputReport, noLongerReported: string): (line: string) => void {
  let reported = 0;
  return (line) => {
    reported += 1;
    if (reported <= mostReportedLines) {
      report(scrub(line).slice(0, mostReportedCharacters));
    }
    if (reported === mostReportedLines + 1) {
      report(noLongerReported);
    }
  };
}

const metaField = '_meta';

export interface ClientInfo {
  readonly name: string;
  readonly version: string;
}

export function openingClient(
  { name, version }: ClientInfo,
  requestIdHeader: string | null,
  reportError: (message: string) => void,
): OpenedClient {
  const client = new Client({ name, version }, { capabilities: {} });
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  Object.assign(client, {
    onclose: resolve,
    onerror: ({ message }: Readonly<Error>) => {
      reportError(message);
    },
  });
  return { client, observations: observations(requestIdHeader, toolBounds.httpAnswerBytes), closed };
}

export function observingFetch<Args extends readonly [unknown, unknown?]>(
  fetch: (...args: Args) => Promise<Response>,
  observed: Observations,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const response = await fetch(...args);
    const [, init] = args;
    return observed.noteAnswered(Predicate.hasProperty(init, 'body') ? init.body : undefined, response);
  };
}

function contentJsonOf(answer: unknown): string {
  const content: unknown = Reflect.get(new Object(answer), 'content');
  const structuredContent: unknown = Reflect.get(new Object(answer), 'structuredContent');
  return JSON.stringify(structuredContent === undefined ? { content } : { content, structuredContent });
}

function settledOf(answer: unknown): { readonly result: ToolResult; readonly resultJson: string } {
  return { result: decodeToolResult(answer), resultJson: contentJsonOf(answer) };
}

export function tracedClient(client: ServerClient, traceMeta: TraceMeta): ServerClient {
  return {
    ...client,
    call: (calling) => client.call({ ...calling, meta: { ...traceMeta(), ...calling.meta } }),
  };
}

export function serverClientOver(
  client: ToolClient,
  observed: Observations,
  closed: Promise<void>,
  end: () => Promise<void>,
): ServerClient {
  return {
    call: async ({ tool, input, meta, signal, timeoutMs }) => {
      const marker = observed.mark();
      const tooLarge = new AbortController();
      observed.whenTooLarge(marker, () => {
        tooLarge.abort();
      });
      const settled = await client
        .request(
          { method: 'tools/call', params: { name: tool, arguments: { ...input }, [metaField]: { ...meta } } },
          { signal: AbortSignal.any([signal, tooLarge.signal]), timeout: timeoutMs, onresumptiontoken: marker },
        )
        .then(settledOf, (error: unknown) => ({ error }));
      return { ...settled, observed: observed.take(marker) };
    },
    listTools: async (timeoutMs) => {
      const listing: unknown = await client.listTools(undefined, { timeout: timeoutMs, cacheMode: 'refresh' });
      return decodeListedTools(listing).tools;
    },
    closed,
    end,
  };
}
