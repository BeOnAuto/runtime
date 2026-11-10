import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '@on.auto/operations';
import { conversationCallsKind } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { conversationKeyOf } from '../conversations/conversation-keys.ts';
import { readingRecordedOf } from '../conversations/read-facts.ts';

export const readingsName = 'readings';

const ReadingRowSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  conversation: Schema.String,
  reading: Schema.String,
  since: Schema.NullOr(Schema.String),
  last_fact: Schema.String,
});

type ReadingRow = typeof ReadingRowSchema.Type;

export const readingRowFrom: (row: ProjectedRow) => ReadingRow = Schema.decodeUnknownSync(ReadingRowSchema);

export function readingKeyOf(conversation: string, reading: string): string {
  return `${conversation}/${reading}`;
}

interface ReadOfAReading {
  readonly server: string;
  readonly tool: string;
  readonly conversation: string;
  readonly reading: string;
  readonly since: string | null;
}

function readOfAReading(message: ProjectedMessage): ReadOfAReading | undefined {
  const read = readingRecordedOf(message);
  if (read?.data.reading === undefined) {
    return undefined;
  }
  const { server, tool, conversation, reading, since } = read.data;
  return { server, tool, conversation, reading, since };
}

function keyOf(read: ReadOfAReading): string {
  return readingKeyOf(
    conversationKeyOf({ server: read.server, tool: read.tool, key: read.conversation }),
    read.reading,
  );
}

export const readings: KeyedProjection = {
  name: readingsName,
  version: 1,
  kinds: [conversationCallsKind],
  types: ['replies_read', 'reading_failed'],
  columns: [
    { name: 'server', kind: 'text' },
    { name: 'tool', kind: 'text' },
    { name: 'conversation', kind: 'text' },
    { name: 'reading', kind: 'text' },
    { name: 'since', kind: 'text' },
    { name: 'last_fact', kind: 'text' },
  ],
  indexes: [],
  keyOf: (message) => {
    const read = readOfAReading(message);
    return read === undefined ? undefined : keyOf(read);
  },
  rowAfter: (_row, message) => {
    const read = readOfAReading(message);
    return read === undefined ? undefined : { ...read, last_fact: message.id };
  },
};
