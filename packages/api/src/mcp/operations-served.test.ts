import { OperationsServed, defineCommand, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

const takesNothing = Schema.Record(Schema.String, Schema.Never);

const keepNote = defineCommand('org', {
  name: 'keep_note',
  title: 'Keep note',
  description: 'Keeps a note of the org. Use it when the person writes one. It answers whether it kept it.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: takesNothing,
  outputSchema: Schema.Struct({ kept: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ kept: true }),
  plainLanguage: { task: 'keep a note', attempt: () => 'keep the note', outcome: () => 'Kept the note.' },
});

const keepsNotesBeside = defineQuery('playbook', {
  name: 'keeps_notes_beside',
  title: 'Keeps notes beside',
  description:
    'Says whether keep_note is served beside it. Use it to learn what the endpoint serves. It answers yes or no.',
  route: { method: 'GET', path: '/notes-beside' },
  inputSchema: takesNothing,
  outputSchema: Schema.Struct({ served: Schema.Boolean }),
  reasons: [],
  handle: () =>
    Effect.gen(function* () {
      const serves = yield* OperationsServed;
      return { served: serves('keep_note') };
    }),
  plainLanguage: { task: 'say what is served', attempt: () => 'say what is served', outcome: () => 'Said it.' },
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [keepNote, keepsNotesBeside] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

async function servedOver(path: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
  const connection = { url: `${listening.origin}${path}`, headers: asAdmin };
  const answer = await withMcpSession('current revision', connection, (session) =>
    session.callTool('keeps_notes_beside', input),
  );
  return answer.structuredContent;
}

describe('the operations a call reads as served beside it', () => {
  it('are the tools of the MCP endpoint that serves it, and every operation over HTTP', async () => {
    const overHttp = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes-beside', { headers: asAdmin });

    expect([
      await servedOver('/mcp', { playbook: 'alpha' }),
      await servedOver('/orgs/acme/playbooks/alpha/mcp', {}),
      overHttp.body,
    ]).toEqual([{ served: true }, { served: false }, { served: true }]);
  });
});
