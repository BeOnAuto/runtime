import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import type { DebugServing } from '../debug/agent-surface.ts';
import { debugPath } from '../debug/debug-path.ts';
import { debugRoutes } from '../debug/debug-routes.ts';
import { readDebugStyle, type DebugStyle } from '../debug/debug-style.ts';
import { apiShippedRoots } from '../shipped-files/api-roots.ts';
import { debugCatalog, debugOperations, directoryShelf } from './debug-operations.ts';
import { testShelf } from './guides.ts';
import { listenOnLoopback, type Listening } from './listening.ts';
import { operationServer, testServerInfo, type OperationServer } from './operation-server.ts';

interface Fetched {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

export interface DebugPageServer {
  readonly listening: Listening;
  readonly page: Fetched;
  readonly fetched: (path: string, headers?: Readonly<Record<string, string>>) => Promise<Fetched>;
  readonly close: () => Promise<void>;
}

function fetcherOf(server: OperationServer): DebugPageServer['fetched'] {
  return async (path, headers = {}) => {
    const response = await server.handler.fetch(new Request(`http://localhost${path}`, { headers }));
    return { status: response.status, headers: response.headers, text: await response.text() };
  };
}

export const debugServing: DebugServing = {
  catalog: debugCatalog,
  shelf: testShelf,
  serverInfo: testServerInfo,
  directoryListing: { catalog: debugCatalog, shelf: directoryShelf },
};

export function debugStyleOnDisk(): Promise<DebugStyle> {
  return readDebugStyle(shippedFilesOnDisk(apiShippedRoots()));
}

export async function debugPageServer(): Promise<DebugPageServer> {
  const debug = debugRoutes(debugServing, await debugStyleOnDisk());
  const server = await operationServer({ operations: debugOperations, routes: [debug] });
  const listening = await listenOnLoopback(server.handler);
  const fetched = fetcherOf(server);
  return {
    listening,
    page: await fetched(debugPath),
    fetched,
    close: async () => {
      await listening.close();
      await server.runtime.dispose();
    },
  };
}

export function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function idsIn(page: string, prefix: string, kind: string): readonly string[] {
  return [...page.matchAll(new RegExp(`id="${prefix}${kind}-([a-z_-]+)"`, 'gu'))]
    .map(([, name = '']: readonly string[]) => name)
    .toSorted();
}
