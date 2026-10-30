import { INVALID_SPAN_CONTEXT, trace } from '@opentelemetry/api';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';
import { metricNamesIn, spansIn } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { tracedRequestOf } from './request-tracing.ts';

async function tracedServer(endpoint = 'OTEL_EXPORTER_OTLP_ENDPOINT', path = '') {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      [endpoint]: `${receiver.endpoint}${path}`,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    },
    defaultServerOptions,
  );
  return { receiver, server };
}

const traceId = 'a'.repeat(32);

const spanId = 'b'.repeat(16);

describe('a request to a server with telemetry', () => {
  it('is a server span, whose trace the answer names in x-trace-id, beside its request id', async () => {
    const { receiver, server } = await tracedServer();
    const answer = await fetch(`http://127.0.0.1:${server.port}/nowhere`);
    await server.stop();
    const [span] = spansIn(receiver.received());

    expect(answer.status).toBe(404);
    expect(span).toMatchObject({
      traceId: answer.headers.get('x-trace-id'),
      kind: 2,
      attributes: {
        'http.request.method': 'GET',
        'http.response.status_code': 404,
        'auto.on.request_id': answer.headers.get('x-request-id'),
      },
    });
  });

  it('continues the trace the caller sent in traceparent', async () => {
    const { receiver, server } = await tracedServer();
    const answer = await fetch(`http://127.0.0.1:${server.port}/nowhere`, {
      headers: { traceparent: `00-${traceId}-${spanId}-01` },
    });
    await server.stop();

    expect(answer.headers.get('x-trace-id')).toBe(traceId);
    expect(spansIn(receiver.received())).toMatchObject([{ traceId, parentSpanId: spanId }]);
  });

  it('leaves the health check untraced', async () => {
    const { receiver, server } = await tracedServer();
    const answer = await fetch(`http://127.0.0.1:${server.port}/health`);
    await server.stop();

    expect(answer.headers.get('x-trace-id')).toBeNull();
    expect(spansIn(receiver.received())).toEqual([]);
  });
});

describe('a request that reads a link', () => {
  it('is a span of the route read_link answers, whose URL masks the token of the link and carries it nowhere', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const receiver = await receivingOtlp();
    onTestFinished(receiver.close);
    const server = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        ...noConsentThroughAuto,
        OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      },
      compositionRoot,
    );
    const token = 'kQ2_x-9fLm3WbP7rTz0aYc5vNd8eHu1oJs4iGq6lXwE';
    const link = `/v1/orgs/local/connections/0199f0e0-0000-7000-8000-000000000000/link`;

    const answer = await fetch(`http://127.0.0.1:${server.port}${link}/${token}`);
    await server.stop();
    const spans = spansIn(receiver.received());

    expect(answer.status).toBe(404);
    expect(spans.filter(({ kind }) => kind === 2)).toMatchObject([
      {
        attributes: {
          'http.route': '/v1/orgs/:org/connections/:id/link/:token',
          'url.full': `http://127.0.0.1:${server.port}${link}/REDACTED`,
        },
      },
    ]);
    expect(JSON.stringify(spans)).not.toContain(token);
  });
});

describe('a request to a server exporting metrics alone', () => {
  it('is measured but not traced, and names no trace', async () => {
    const { receiver, server } = await tracedServer('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', '/v1/metrics');
    const answer = await fetch(`http://127.0.0.1:${server.port}/nowhere`);
    await server.stop();

    expect(answer.headers.get('x-trace-id')).toBeNull();
    expect(spansIn(receiver.received())).toEqual([]);
    expect(metricNamesIn(receiver.received())).toContain('http.server.request.duration');
  });
});

describe('the trace of a request', () => {
  it('is none without a span, or with a span that names no trace', () => {
    expect([tracedRequestOf(), tracedRequestOf(trace.wrapSpanContext(INVALID_SPAN_CONTEXT))]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('is the trace and the span of a valid span, sampled when its trace flags say so', () => {
    const sampled = trace.wrapSpanContext({ traceId, spanId, traceFlags: 1 });
    const unsampled = trace.wrapSpanContext({ traceId, spanId, traceFlags: 0 });

    expect([tracedRequestOf(sampled)?.parent, tracedRequestOf(unsampled)?.parent]).toEqual([
      { traceId, spanId, sampled: true },
      { traceId, spanId, sampled: false },
    ]);
  });
});
