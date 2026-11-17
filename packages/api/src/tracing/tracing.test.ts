import { memoryLedger, memoryPlaybookRegistry, recordingReporter, recordingTracer } from '@on.auto/operations/testing';
import { Effect, Layer, Logger } from 'effect';
import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';

import type { ApiEnv } from '../api-env.ts';
import { call } from '../testing/api-calls.ts';
import { postMcp } from '../testing/mcp-requests.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';
import { linksOfMeta, underTraceParent } from './trace-parent.ts';

const traceId = 'c'.repeat(32);

const spanId = 'd'.repeat(16);

const linklessMetas: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>> | undefined]> = [
  ['no meta', undefined],
  ['no traceparent', {}],
  ['a traceparent that is not text', { traceparent: 7 }],
  ['a traceparent that is not W3C trace context', { traceparent: 'not-a-traceparent' }],
];

describe('the links of the meta of an MCP request', () => {
  it('link to the span a W3C traceparent names', () => {
    expect(linksOfMeta({ traceparent: `00-${traceId}-${spanId}-01` })).toMatchObject([
      { span: { traceId, spanId, sampled: true }, attributes: {} },
    ]);
  });

  it.each(linklessMetas)('are none for %s', (_case, meta) => {
    expect(linksOfMeta(meta)).toEqual([]);
  });
});

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

interface Annotated {
  readonly annotations: Readonly<Record<string, unknown>>;
}

describe('an effect run under a trace parent', () => {
  it('logs with the trace id of the parent', async () => {
    const annotated: Readonly<Record<string, unknown>>[] = [];
    const capturing = Logger.map(Logger.formatStructured, ({ annotations }: Annotated) => {
      annotated.push(annotations);
    });

    await Effect.runPromise(
      underTraceParent(Effect.logInfo('hello'), { traceId, spanId, sampled: true }).pipe(
        Effect.provide(Layer.mergeAll(services, Logger.layer([capturing]))),
      ),
    );

    expect(annotated).toEqual([{ trace_id: traceId }]);
  });
});

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
