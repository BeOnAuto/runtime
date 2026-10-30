import { defineQuery } from '@on.auto/operations';
import { Context, Effect, Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

class Invocation extends Context.Service<Invocation, string>()('test/Invocation') {}

const nameTheInvocation = defineQuery('playbook', {
  name: 'name_the_invocation',
  title: 'Name the invocation',
  description: 'Names the invocation that asks. Use it to learn which one did. It answers its name.',
  route: { method: 'GET', path: '/invocation' },
  inputSchema: Schema.Struct({
    about: Schema.optionalKey(Schema.String.annotate({ description: 'What it is asked about' })),
  }),
  outputSchema: Schema.Struct({ invocation: Schema.String }),
  reasons: [],
  handle: () =>
    Effect.serviceOption(Invocation).pipe(
      Effect.map(Option.getOrElse(() => 'none')),
      Effect.map((invocation) => ({ invocation })),
    ),
  plainLanguage: { task: 'name the invocation', attempt: () => 'name the invocation', outcome: () => 'Named.' },
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({
    operations: [...notebookOperations, nameTheInvocation],
    callContext: (request) => Context.make(Invocation, request.headers.get('x-invocation') ?? 'unnamed'),
  });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

const asked = { authorization: `Bearer ${acmeAdmin.key}`, 'x-invocation': 'invocation-7' };

describe('the context of a call', () => {
  it('reaches the operation a request over HTTP dispatches, made of the request', async () => {
    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/invocation', { headers: asked });

    expect([answer.status, answer.body]).toEqual([200, { invocation: 'invocation-7' }]);
  });

  it('reaches the operation a tool of the MCP endpoint dispatches, made of the request that called the tool', async () => {
    const result = await withMcpSession(
      'current revision',
      { url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`, headers: asked },
      (session) => session.callTool('name_the_invocation'),
    );

    expect(result.structuredContent).toEqual({ invocation: 'invocation-7' });
  });
});
