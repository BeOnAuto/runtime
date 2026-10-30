import { Exit, Option, Tracer, type Context } from 'effect';

interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

interface LinkStart {
  readonly span: SpanContext;
  readonly attributes: Readonly<Record<string, unknown>>;
}

interface ParentStart {
  readonly _tag: 'None' | 'Some';
  readonly value?: SpanContext;
}

interface SpanStart {
  readonly name: string;
  readonly parent: ParentStart;
  readonly annotations: Context.Context<never>;
  readonly links: readonly LinkStart[];
  readonly startTime: bigint;
  readonly kind: Tracer.SpanKind;
  readonly sampled: boolean;
}

type SpanEnding = 'open' | 'succeeded' | 'failed';

export interface RecordedSpan {
  readonly name: string;
  readonly kind: Tracer.SpanKind;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly links: readonly Omit<SpanContext, 'sampled'>[];
  readonly ending: SpanEnding;
}

export interface RecordingTracer {
  readonly tracer: Tracer.Tracer;
  readonly spans: () => readonly RecordedSpan[];
}

function externalOf({ traceId, spanId, sampled }: SpanContext): Tracer.ExternalSpan {
  return Tracer.externalSpan({ traceId, spanId, sampled });
}

function parentOf({ value }: ParentStart): Option.Option<Tracer.AnySpan> {
  return value === undefined ? Option.none() : Option.some(externalOf(value));
}

function linkOf({ span, attributes }: LinkStart): Tracer.SpanLink {
  return { span: externalOf(span), attributes };
}

function linkedOf({ span: { traceId, spanId } }: LinkStart): Omit<SpanContext, 'sampled'> {
  return { traceId, spanId };
}

export function recordingTracer(): RecordingTracer {
  const started: Tracer.NativeSpan[] = [];
  return {
    tracer: Tracer.make({
      span: (start: SpanStart) => {
        const span = new Tracer.NativeSpan({
          ...start,
          parent: parentOf(start.parent),
          links: start.links.map(linkOf),
        });
        started.push(span);
        return span;
      },
    }),
    spans: () => {
      const recorded: RecordedSpan[] = [];
      for (const span of started) {
        const { status } = span;
        let ending: SpanEnding = 'open';
        if ('exit' in status) {
          ending = Exit.isSuccess(status.exit) ? 'succeeded' : 'failed';
        }
        recorded.push({
          name: span.name,
          kind: span.kind,
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: Option.getOrUndefined(span.parent)?.spanId,
          attributes: Object.fromEntries(span.attributes),
          links: span.links.map(linkedOf),
          ending,
        });
      }
      return recorded;
    },
  };
}
