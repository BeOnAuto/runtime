import type { DispatcherServices } from '@on.auto/operations';
import { Effect, Option, Schema, Tracer } from 'effect';
import { Headers, HttpTraceContext } from 'effect/http';

export interface TraceParent {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

export const TraceParentSchema = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  sampled: Schema.Boolean,
});

export function underTraceParent<A, E>(
  effect: Effect.Effect<A, E, DispatcherServices>,
  parent: TraceParent | undefined,
): Effect.Effect<A, E, DispatcherServices> {
  return parent === undefined
    ? effect
    : effect.pipe(
        Effect.annotateLogs({ trace_id: parent.traceId }),
        Effect.withParentSpan(Tracer.externalSpan(parent)),
      );
}

function linkTo(span: Tracer.ExternalSpan): readonly Tracer.SpanLink[] {
  return [{ span, attributes: {} }];
}

export function linksOfMeta(meta: Readonly<Record<string, unknown>> | undefined): readonly Tracer.SpanLink[] {
  const traceparent = meta?.['traceparent'];
  return typeof traceparent === 'string'
    ? Option.match(HttpTraceContext.w3c(Headers.fromInput({ traceparent })), { onNone: () => [], onSome: linkTo })
    : [];
}
