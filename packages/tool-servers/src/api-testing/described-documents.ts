import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, type Schema } from 'effect';
import { onTestFinished } from 'vitest';

import type { DescribedApiSettings, Describing } from '../openapi/described-api.ts';
import { describedToolServers } from '../openapi/described-servers.ts';
import { readToolServerSettings, type ToolServerSettingsContext } from '../settings/settings-reading.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import { fakeApiDocument } from './fake-api-document.ts';

type Entries = Readonly<Record<string, unknown>>;

export interface DescribingOptions extends Partial<Describing> {
  readonly documents?: ToolServerSettingsContext['documents'];
}

const refused = 'The documents of the tool servers could not be read. TOOL_SERVERS: /graph';

export const documentProblem = (detail: string): string => `${refused}/document: ${detail}`;

export const baseUrlProblem = (detail: string): string => `${refused}/base_url: ${detail}`;

export function directoryWith(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-openapi-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

export async function servedDocumentAt(answer: () => Promise<Response>): Promise<string> {
  const listening = await serveOnLoopback(() => answer);
  onTestFinished(listening.close);
  return `${listening.origin}/openapi.json`;
}

export function documentWithServer(url: string, variables?: Schema.JsonObject): string {
  return JSON.stringify({
    ...fakeApiDocument('3.1', url),
    servers: [{ url, ...(variables === undefined ? {} : { variables }) }],
  });
}

export interface CountedFetch<Args extends readonly [unknown, unknown?]> {
  readonly fetch: (...args: Args) => Promise<Response>;
  readonly fetched: () => readonly unknown[];
}

export function countedFetch<Args extends readonly [unknown, unknown?]>(
  original: (...args: Args) => Promise<Response>,
): CountedFetch<Args> {
  const fetched: unknown[] = [];
  return {
    fetch: (...args) => {
      fetched.push(args[0]);
      return original(...args);
    },
    fetched: () => [...fetched],
  };
}

export function documentsIn(directory: string): DescribingOptions {
  return { documents: { kind: 'directory', path: directory } };
}

export function describing(entries: Entries, { documents, ...more }: DescribingOptions = {}) {
  const leftOut: (Parameters<Describing['reportLeftOut']>[1] & { readonly server: string })[] = [];
  const effect = readToolServerSettings(
    { TOOL_SERVERS: JSON.stringify(entries), GRAPH_API_KEY: 'graph-api-key-4f1d9a7c2b' },
    { modelProviders: [], ...(documents === undefined ? {} : { documents }) },
  ).pipe(
    Effect.flatMap((settings) =>
      describedToolServers(settings, {
        reportLeftOut: (server, operation) => {
          leftOut.push({ server, ...operation });
        },
        ...more,
      }),
    ),
  );
  return { effect, leftOut };
}

export async function describedApiOf(entries: Entries, options?: DescribingOptions) {
  const { servers } = await Effect.runPromise(describing(entries, options).effect);
  return servers.filter((server): server is DescribedApiSettings => server.type === 'openapi').map(({ api }) => api)[0];
}

export async function refusalOf(entries: Entries, options?: DescribingOptions): Promise<string> {
  const failure = await Effect.runPromise(Effect.flip(describing(entries, options).effect));
  return failure.message;
}
