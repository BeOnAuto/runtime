import { JSONSerializer } from '@event-driven-io/dumbo';
import { pgPool } from '@event-driven-io/dumbo/pg';
import {
  PostgreSQLEventStoreCheckpoint,
  readLastCommittedMessageCheckpoint,
  readMessagesBatch,
} from '@event-driven-io/emmett-postgresql';
import type pg from 'pg';

import type { RecordedPoint } from '../event-store.ts';
import { samePoint, type LoggedEvent, type LogPorts } from './ledger-log.ts';

function pointOf({ transactionId, globalPosition }: Readonly<PostgreSQLEventStoreCheckpoint>): RecordedPoint {
  return [String(transactionId), String(globalPosition)];
}

function checkpointOf(point: RecordedPoint | undefined): PostgreSQLEventStoreCheckpoint {
  const [transactionId = '0', globalPosition = '0'] = point ?? [];
  return { transactionId: BigInt(transactionId), globalPosition: BigInt(globalPosition) };
}

interface ReadMessage {
  readonly type: string;
  readonly metadata: {
    readonly messageId: string;
    readonly streamName: string;
    readonly streamPosition: bigint;
    readonly checkpoint?: Parameters<typeof PostgreSQLEventStoreCheckpoint.parse>[0];
  };
}

function loggedOf({ type, metadata }: ReadMessage): LoggedEvent {
  return {
    id: metadata.messageId,
    stream: metadata.streamName,
    version: Number(metadata.streamPosition),
    type,
    point: pointOf(PostgreSQLEventStoreCheckpoint.parse(metadata.checkpoint)),
  };
}

export function postgresqlLogOn(pooled: () => pg.Pool): LogPorts {
  const { execute } = pgPool({ pool: pooled(), serialization: { serializer: JSONSerializer } });
  return {
    head: async () => {
      const { currentCheckpoint } = await readLastCommittedMessageCheckpoint(execute);
      return currentCheckpoint === null ? undefined : pointOf(currentCheckpoint);
    },
    after: async (point, most) => {
      const batch = await readMessagesBatch(execute, {
        after: checkpointOf(point),
        batchSize: most,
      });
      const events = batch.messages.map((message: ReadMessage) => loggedOf(message));
      return { events, through: events.at(-1)?.point ?? point, more: batch.areMessagesLeft };
    },
    at: async (point) => {
      const { messages } = await readMessagesBatch(execute, {
        from: checkpointOf(point),
        batchSize: 1,
      });
      const found = messages.map((message: ReadMessage) => loggedOf(message)).at(0);
      return found !== undefined && samePoint(found.point, point) ? found : undefined;
    },
  };
}
