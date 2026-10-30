import { Schema } from 'effect';

import type { ReceivedExport } from './otlp-receiver.ts';

type Attributes = Readonly<Record<string, unknown>>;

interface KeyValue {
  readonly key: string;
  readonly value: Attributes;
}

interface Resourced {
  readonly resource: { readonly attributes: readonly KeyValue[] };
}

interface Link {
  readonly traceId: string;
  readonly spanId: string;
}

interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly attributes: readonly KeyValue[];
  readonly links: readonly Link[];
  readonly status: { readonly code?: number };
}

interface LogRecord {
  readonly eventName?: string;
  readonly severityText?: string;
  readonly body: Attributes;
  readonly attributes: readonly KeyValue[];
  readonly traceId?: string;
  readonly spanId?: string;
}

interface ScopeLogs {
  readonly scope: { readonly name: string };
  readonly logRecords: readonly LogRecord[];
}

interface ScopeMetrics {
  readonly metrics: readonly { readonly name: string }[];
}

const KeyValueSchema = Schema.Struct({ key: Schema.String, value: Schema.Record(Schema.String, Schema.Unknown) });

const AttributesSchema = Schema.Array(KeyValueSchema);

const ResourceSchema = Schema.Struct({ attributes: AttributesSchema });

const SpanSchema = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optionalKey(Schema.String),
  name: Schema.String,
  kind: Schema.Number,
  attributes: AttributesSchema,
  links: Schema.Array(Schema.Struct({ traceId: Schema.String, spanId: Schema.String })),
  status: Schema.Struct({ code: Schema.optionalKey(Schema.Number) }),
});

const TracesSchema = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      resource: ResourceSchema,
      scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(SpanSchema) })),
    }),
  ),
});

const LogRecordSchema = Schema.Struct({
  eventName: Schema.optionalKey(Schema.String),
  severityText: Schema.optionalKey(Schema.String),
  body: Schema.Record(Schema.String, Schema.Unknown),
  attributes: AttributesSchema,
  traceId: Schema.optionalKey(Schema.String),
  spanId: Schema.optionalKey(Schema.String),
});

const LogsSchema = Schema.Struct({
  resourceLogs: Schema.Array(
    Schema.Struct({
      resource: ResourceSchema,
      scopeLogs: Schema.Array(
        Schema.Struct({ scope: Schema.Struct({ name: Schema.String }), logRecords: Schema.Array(LogRecordSchema) }),
      ),
    }),
  ),
});

const MetricsSchema = Schema.Struct({
  resourceMetrics: Schema.Array(
    Schema.Struct({
      resource: ResourceSchema,
      scopeMetrics: Schema.Array(Schema.Struct({ metrics: Schema.Array(Schema.Struct({ name: Schema.String })) })),
    }),
  ),
});

const decodeTraces = Schema.decodeUnknownSync(TracesSchema);

const decodeLogs = Schema.decodeUnknownSync(LogsSchema);

const decodeMetrics = Schema.decodeUnknownSync(MetricsSchema);

export interface ExportedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly kind: number;
  readonly attributes: Attributes;
  readonly links: readonly Link[];
  readonly statusCode: number | undefined;
}

export interface ExportedLog {
  readonly scope: string;
  readonly eventName: string | undefined;
  readonly severityText: string | undefined;
  readonly body: unknown;
  readonly attributes: Attributes;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
}

function attributesOf(pairs: readonly KeyValue[]): Attributes {
  return Object.fromEntries(pairs.map(({ key, value }: KeyValue) => [key, Object.values(value).at(0)]));
}

function jsonExportsAt(received: readonly ReceivedExport[], path: string): readonly unknown[] {
  return received
    .filter((exported: ReceivedExport) => exported.path === path && exported.contentType === 'application/json')
    .map(({ text }: ReceivedExport): unknown => JSON.parse(text));
}

function exportedSpanOf({ attributes, status, parentSpanId, ...span }: Span): ExportedSpan {
  return { ...span, parentSpanId, attributes: attributesOf(attributes), statusCode: status.code };
}

function exportedLogsOf({ scope, logRecords }: ScopeLogs): readonly ExportedLog[] {
  return logRecords.map((record: LogRecord) => ({
    scope: scope.name,
    eventName: record.eventName,
    severityText: record.severityText,
    body: Object.values(record.body).at(0),
    attributes: attributesOf(record.attributes),
    traceId: record.traceId,
    spanId: record.spanId,
  }));
}

export function spansIn(received: readonly ReceivedExport[]): readonly ExportedSpan[] {
  return jsonExportsAt(received, '/v1/traces')
    .flatMap((exported) => decodeTraces(exported).resourceSpans)
    .flatMap(({ scopeSpans }: { readonly scopeSpans: readonly { readonly spans: readonly Span[] }[] }) => scopeSpans)
    .flatMap(({ spans }: { readonly spans: readonly Span[] }) => spans.map((span: Span) => exportedSpanOf(span)));
}

export function logsIn(received: readonly ReceivedExport[]): readonly ExportedLog[] {
  return jsonExportsAt(received, '/v1/logs')
    .flatMap((exported) => decodeLogs(exported).resourceLogs)
    .flatMap(({ scopeLogs }: { readonly scopeLogs: readonly ScopeLogs[] }) => scopeLogs)
    .flatMap((scopeLogs: ScopeLogs) => exportedLogsOf(scopeLogs));
}

export function metricNamesIn(received: readonly ReceivedExport[]): readonly string[] {
  return jsonExportsAt(received, '/v1/metrics')
    .flatMap((exported) => decodeMetrics(exported).resourceMetrics)
    .flatMap(({ scopeMetrics }: { readonly scopeMetrics: readonly ScopeMetrics[] }) => scopeMetrics)
    .flatMap(({ metrics }: ScopeMetrics) => metrics.map(({ name }: { readonly name: string }) => name));
}

export function resourceIn(received: readonly ReceivedExport[]): Attributes {
  return attributesOf(
    jsonExportsAt(received, '/v1/traces')
      .flatMap((exported) => decodeTraces(exported).resourceSpans)
      .flatMap(({ resource }: Resourced) => resource.attributes),
  );
}
