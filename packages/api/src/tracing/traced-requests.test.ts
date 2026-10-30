import { recordingTracer } from '@on.auto/operations/testing';
import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';

import type { ApiEnv } from '../api-env.ts';
import { call } from '../testing/api-calls.ts';
import { postMcp } from '../testing/mcp-requests.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const parent = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: true };

const givingParent: MiddlewareHandler<ApiEnv> = async (c, next) => {
  c.set('traceParent', parent);
  await next();
};

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

function toolCall(meta: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'list_notes', arguments: {}, _meta: meta },
  });
}

describe('an operation called over HTTP', () => {
  it('runs under the trace parent the requests middleware found', async () => {
    const { tracer, spans } = recordingTracer();
    const { handler } = await operationServer({ requests: givingParent, tracer });

    expect((await call(handler, notes, { headers: asAdmin })).status).toBe(200);
    expect(spans()).toMatchObject([{ name: 'list_notes', traceId: parent.traceId, parentSpanId: parent.spanId }]);
  });

  it('starts a trace of its own when no trace parent was found', async () => {
    const { tracer, spans } = recordingTracer();
    const { handler } = await operationServer({ tracer });

    expect((await call(handler, notes, { headers: asAdmin })).status).toBe(200);
    expect(spans()).toMatchObject([{ name: 'list_notes', parentSpanId: undefined }]);
  });
});

describe('a tool called over MCP', () => {
  it('runs in a tools/call span under the trace parent of its request, linked to the traceparent of its meta', async () => {
    const { tracer, spans } = recordingTracer();
    const { handler } = await operationServer({ requests: givingParent, tracer });
    const traceparent = `00-${'c'.repeat(32)}-${'d'.repeat(16)}-01`;

    await postMcp(
      handler,
      '/orgs/acme/playbooks/alpha/mcp',
      { ...asAdmin, 'mcp-protocol-version': '2025-11-25' },
      toolCall({ traceparent }),
    );
    const [tool, operation] = spans();

    expect(tool).toMatchObject({
      name: 'tools/call list_notes',
      kind: 'server',
      traceId: parent.traceId,
      parentSpanId: parent.spanId,
      attributes: {
        'mcp.method.name': 'tools/call',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'list_notes',
        'jsonrpc.request.id': '7',
      },
      links: [{ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) }],
    });
    expect(operation).toMatchObject({ name: 'list_notes', parentSpanId: tool?.spanId });
  });

  it('runs in a tools/call span of a trace of its own when its request found no trace parent', async () => {
    const { tracer, spans } = recordingTracer();
    const { handler } = await operationServer({ tracer });

    await postMcp(handler, '/mcp', { ...asAdmin, 'mcp-protocol-version': '2025-11-25' }, toolCall({}));

    expect(spans()).toMatchObject([{ name: 'tools/call list_notes', parentSpanId: undefined, links: [] }]);
  });
});
