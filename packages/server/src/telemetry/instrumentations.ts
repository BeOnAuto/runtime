import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

import { redactedUrlAttributes, type RequestTarget } from './redacted-url.ts';

export function startInstrumentations(): () => void {
  return registerInstrumentations({
    instrumentations: [
      new UndiciInstrumentation({
        requireParentforSpans: true,
        startSpanHook: (request: RequestTarget) => redactedUrlAttributes(request),
      }),
      new RuntimeNodeInstrumentation(),
      new EmmettInstrumentation({ includeMessagePayloads: false }),
    ],
  });
}
