import { randomUUID } from 'node:crypto';

import { WebStandardStreamableHTTPServerTransport, type McpServer } from '@modelcontextprotocol/server';

import { fakeToolServer, type FakeToolState } from './fake-tools.ts';

export interface FakeSessions {
  readonly opened: (request: Readonly<Request>) => Promise<Response>;
  readonly answered: (id: string, request: Readonly<Request>) => Promise<Response> | undefined;
  readonly open: () => number;
  readonly ended: () => number;
  readonly forget: () => void;
  readonly notifyToolsChanged: () => void;
}

interface Session {
  readonly transport: WebStandardStreamableHTTPServerTransport;
  readonly server: McpServer;
}

export type ToolRecords = Omit<FakeToolState, 'exit'>;

export function fakeSessions(records: ToolRecords, issuesSessionIds = true): FakeSessions {
  const sessions = new Map<string, Session>();
  let ended = 0;
  const closeEvery = (): void => {
    for (const { transport } of sessions.values()) {
      void transport.close();
    }
  };
  return {
    opened: async (request) => {
      const server = fakeToolServer({ ...records, exit: closeEvery });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: issuesSessionIds ? randomUUID : undefined,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server });
        },
        onsessionclosed: (id) => {
          ended += 1;
          sessions.delete(id);
        },
      });
      await server.connect(transport);
      return transport.handleRequest(request);
    },
    answered: (id, request) => sessions.get(id)?.transport.handleRequest(request),
    open: () => sessions.size,
    ended: () => ended,
    forget: () => {
      closeEvery();
      sessions.clear();
    },
    notifyToolsChanged: () => {
      for (const { server } of sessions.values()) {
        server.sendToolListChanged();
      }
    },
  };
}
