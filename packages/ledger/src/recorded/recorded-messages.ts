import type { RecordedMessage } from '../event-store.ts';
import { readMetadataOf } from './recorded-statements.ts';

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
