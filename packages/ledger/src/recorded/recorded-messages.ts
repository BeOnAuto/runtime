import { contextOf } from '@on.auto/operations';
import { Schema } from 'effect';

import type { RecordedMessage, StoredMetadata } from '../event-store.ts';

const TraceSchema = Schema.Struct({
  causationId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  traceId: Schema.optionalKey(Schema.String),
  spanId: Schema.optionalKey(Schema.String),
});

const decodeTrace = Schema.decodeUnknownSync(TraceSchema);

export interface ReadMetadata {
  readonly causationId: string | null;
  readonly metadata: StoredMetadata;
}

export function readMetadataOf(stored: unknown): ReadMetadata {
  const { causationId = null, traceId, spanId } = decodeTrace(stored);
  return {
    causationId,
    metadata: {
      context: contextOf(stored),
      ...(traceId === undefined ? {} : { traceId }),
      ...(spanId === undefined ? {} : { spanId }),
    },
  };
}

export interface MessageRow {
  readonly type: string;
  readonly id: string;
  readonly metadata: unknown;
  readonly correlation: string | null;
}

export function messageOfRow({ type, id, metadata, correlation }: MessageRow, data: unknown): RecordedMessage {
  const read = readMetadataOf(metadata);
  return {
    type,
    data,
    context: read.metadata.context,
    lineage: { id, causationId: read.causationId, correlationId: correlation },
  };
}
