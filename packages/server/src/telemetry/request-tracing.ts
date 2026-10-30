import { httpInstrumentationMiddleware } from '@hono/otel';
import type { ApiEnv, TraceParent } from '@on.auto/api';
import { trace, type Span } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';

import { withoutTheTokenOfALink } from './redacted-url.ts';

const untracedPaths: ReadonlySet<string> = new Set(['/health']);

interface TracedRequest {
  readonly span: Span;
  readonly parent: TraceParent;
}

export function tracedRequestOf(span?: Span): TracedRequest | undefined {
  if (span === undefined) {
    return undefined;
  }
  const { traceId, spanId, traceFlags } = span.spanContext();
  return trace.isSpanContextValid(span.spanContext())
    ? { span, parent: { traceId, spanId, sampled: traceFlags % 2 === 1 } }
    : undefined;
}

export function requestTracing(): MiddlewareHandler<ApiEnv> {
  const instrumented = httpInstrumentationMiddleware({ captureRequestHeaders: [], captureResponseHeaders: [] });
  return (c, next) =>
    untracedPaths.has(c.req.path)
      ? next()
      : instrumented(c, async () => {
          const traced = tracedRequestOf(trace.getActiveSpan());
          traced?.span.setAttribute('url.full', withoutTheTokenOfALink(c.req.url));
          c.set('traceParent', traced?.parent);
          await next();
          traced?.span.setAttribute('auto.on.request_id', c.get('requestId'));
          if (traced !== undefined) {
            c.header('x-trace-id', traced.parent.traceId);
          }
        });
}
