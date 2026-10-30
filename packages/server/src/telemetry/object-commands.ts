import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { Schema } from 'effect';

const commandOf = Schema.decodeUnknownSync(Schema.Struct({ commandName: Schema.String }));

export const commandSpanStep = { step: 'initialize', name: 'commandSpans' } as const;

async function ended<Out>(span: Span, sent: Promise<Out>): Promise<Out> {
  try {
    return await sent;
  } catch (failure) {
    span.setAttribute('error.type', String(Reflect.get(new Object(failure), 'name')));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw failure;
  } finally {
    span.end();
  }
}

export function commandSpansIn(bucket: string) {
  const tracer = trace.getTracer('@on.auto/object-storage');
  return <Args, Out>(next: (args: Args) => Promise<Out>, context: unknown) =>
    (args: Args): Promise<Out> => {
      const method = commandOf(context).commandName.replace(/Command$/u, '');
      const attributes = {
        'rpc.system': 'aws-api',
        'rpc.service': 'S3',
        'rpc.method': method,
        'aws.s3.bucket': bucket,
      };
      return tracer.startActiveSpan(`S3.${method}`, { kind: SpanKind.CLIENT, attributes }, (span: Span) =>
        ended(span, next(args)),
      );
    };
}
