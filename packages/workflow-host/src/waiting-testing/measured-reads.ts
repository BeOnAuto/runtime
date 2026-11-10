import type { LedgerStreams, RecordedStream } from '@on.auto/ledger';

import type { HostDatabase } from '../database/host-database.ts';

type RecordedMessage = RecordedStream['messages'][number];

export interface MeasuredReads {
  readonly database: HostDatabase;
  readonly bytesRead: () => number;
}

function dataBytesOf(messages: readonly RecordedMessage[]): number {
  return messages.reduce((sum, { data }) => sum + JSON.stringify(data).length, 0);
}

function isAMessage(message: RecordedMessage | undefined): message is RecordedMessage {
  return message !== undefined;
}

export function readingMeasured(database: HostDatabase): MeasuredReads {
  const read: number[] = [];
  const store: LedgerStreams = {
    ...database.store,
    read: async (stream, after) => {
      const answer = await database.store.read(stream, after);
      read.push(dataBytesOf(answer.messages));
      return answer;
    },
    messageAt: async (stream, version) => {
      const message = await database.store.messageAt(stream, version);
      read.push(dataBytesOf([message].filter((each) => isAMessage(each))));
      return message;
    },
    lastMessageOf: async (stream) => {
      const message = await database.store.lastMessageOf(stream);
      read.push(dataBytesOf([message].filter((each) => isAMessage(each))));
      return message;
    },
  };
  return { database: { ...database, store }, bytesRead: () => read.reduce((sum, bytes) => sum + bytes, 0) };
}
