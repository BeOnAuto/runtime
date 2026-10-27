import { JSONSerializer, type SQLExecutor } from '@event-driven-io/dumbo';
import { readLastMessageGlobalPosition, readMessagesBatch } from '@event-driven-io/emmett-sqlite';

import type { RecordedPoint } from '../event-store.ts';
import { samePoint, type LoggedEvent, type LogPorts } from './ledger-log.ts';
import { unreadableAfter } from './unreadable-event.ts';

interface ReadMessage {
  readonly type: string;
  readonly metadata: {
    readonly messageId: string;
    readonly streamName: string;
    readonly streamPosition: bigint;
    readonly globalPosition: string;
  };
}

function loggedOf({ type, metadata }: ReadMessage): LoggedEvent {
  return {
    id: metadata.messageId,
    stream: metadata.streamName,
    version: Number(metadata.streamPosition),
    type,
    point: [String(BigInt(metadata.globalPosition))],
  };
}

function positionOf(point: RecordedPoint | undefined): bigint {
  const [position = '0'] = point ?? [];
  return BigInt(position);
}

export function sqliteLogOn(execute: SQLExecutor): LogPorts {
  return {
    head: async () => {
      const { currentGlobalPosition } = await readLastMessageGlobalPosition(execute);
      return currentGlobalPosition === null ? undefined : [String(currentGlobalPosition)];
    },
    after: async (point, most) => {
      const batch = await readMessagesBatch(execute, {
        after: positionOf(point),
        batchSize: most,
        serializer: JSONSerializer,
      }).catch(unreadableAfter(point));
      const events = batch.messages.map((message: ReadMessage) => loggedOf(message));
      return { events, through: events.at(-1)?.point ?? point, more: batch.areMessagesLeft };
    },
    at: async (point) => {
      const { messages } = await readMessagesBatch(execute, {
        from: positionOf(point),
        batchSize: 1,
        serializer: JSONSerializer,
      });
      const found = messages.map((message: ReadMessage) => loggedOf(message)).at(0);
      return found !== undefined && samePoint(found.point, point) ? found : undefined;
    },
  };
}
