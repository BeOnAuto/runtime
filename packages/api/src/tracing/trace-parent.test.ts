import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

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
