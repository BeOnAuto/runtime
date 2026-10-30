import type { RecordedEvent } from '@on.auto/operations';
import type { StartCall } from '@on.auto/workflow-engine';
import { Effect, Option, Tracer } from 'effect';

import { addressOfRun } from './run-address.ts';

export interface SpanIdentity {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

function identityOf({ traceId, spanId, sampled }: SpanIdentity): SpanIdentity {
  return { traceId, spanId, sampled };
}

export const currentSpanIdentity: Effect.Effect<SpanIdentity | undefined> = Effect.map(
  Effect.option(Effect.map(Effect.currentParentSpan, identityOf)),
  Option.getOrUndefined,
);

export interface SpanReference {
  readonly traceId: string;
  readonly spanId: string;
}

export function linksTo(reference?: SpanReference): readonly Tracer.SpanLink[] {
  return reference === undefined
    ? []
    : [{ span: Tracer.externalSpan({ ...reference, sampled: true }), attributes: {} }];
}

function referenceOf({ traceId, spanId }: Pick<RecordedEvent, 'traceId' | 'spanId'>): {
  readonly trace?: SpanReference;
} {
  return traceId === undefined || spanId === undefined ? {} : { trace: { traceId, spanId } };
}

export function followSpanOf(record: RecordedEvent): Tracer.SpanOptions {
  const { id, stream, version, correlationId } = record;
  return {
    attributes: {
      'auto.on.stream': stream,
      'auto.on.position': version,
      'auto.on.message_id': id,
      ...(correlationId === null ? {} : { 'auto.on.correlation_id': correlationId }),
    },
    links: linksTo(referenceOf(record).trace),
  };
}

export function runAttributesOf(runKey: string): Readonly<Record<string, string>> {
  const { org, playbook, runId } = addressOfRun(runKey);
  return { 'auto.on.org': org, 'auto.on.playbook': playbook, 'auto.on.run_id': runId };
}

export function callSpanOf({ key, function: called }: StartCall, parent?: SpanIdentity): Tracer.SpanOptions {
  return {
    attributes: {
      ...runAttributesOf(key.runId),
      'auto.on.call.function': called,
      'auto.on.call.reference': key.reference,
    },
    parent: parent === undefined ? undefined : Tracer.externalSpan(parent),
  };
}
