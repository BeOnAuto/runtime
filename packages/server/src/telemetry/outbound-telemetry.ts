import { OpenTelemetry } from '@ai-sdk/otel';
import { context, propagation } from '@opentelemetry/api';

import type { OutboundTelemetry } from './telemetry.ts';

function traceMeta(): Readonly<Record<string, string>> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function outboundTelemetry(content: boolean): OutboundTelemetry {
  return { models: { integrations: [new OpenTelemetry()], recordContent: content }, traceMeta };
}
