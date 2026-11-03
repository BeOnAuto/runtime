import { defineCommand, defineQuery, DirectoryListing } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { plainTextIn, withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { listedTools } from '../testing/tool-listing.ts';

const answering = {
  title: 'Listing',
  description: 'Answers whether the call came through the directory listing. Use it to see. It changes nothing.',
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ directory: Schema.Boolean }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    return { directory: yield* DirectoryListing };
  }),
  plainLanguage: {
    task: 'answer the listing',
    attempt: () => 'answer the listing',
    outcome: ({ directory }: { readonly directory: boolean }) => (directory ? 'In the listing.' : 'Outside it.'),
  },
};

const inTheOrg = defineQuery('org', { ...answering, name: 'org_listing', route: { method: 'GET', path: '/listing' } });

const inAPlaybook = defineCommand('playbook', {
  ...answering,
  name: 'playbook_listing',
  route: { method: 'POST', path: '/listing' },
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [inTheOrg, inAPlaybook] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function calledAt(path: string) {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => ({
      tools: listedTools(await session.listTools()).map(({ name }) => name),
      inTheOrg: plainTextIn(await session.callTool('org_listing')),
      inAPlaybook: plainTextIn(await session.callTool('playbook_listing', { playbook: 'alpha' })),
    }),
  );
}

describe('the directory listing at /directory', () => {
  it('lists the tools of /mcp, and its calls reach the org and a playbook as calls through the directory listing', async () => {
    const [everything, directory] = [await calledAt('/mcp'), await calledAt('/directory')];

    expect(directory.tools).toEqual(everything.tools);
    expect([everything.inTheOrg, everything.inAPlaybook]).toEqual(['Outside it.', 'Outside it.']);
    expect([directory.inTheOrg, directory.inAPlaybook]).toEqual(['In the listing.', 'In the listing.']);
  });
});
