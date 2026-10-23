import type { RecordedEvent } from '@on.auto/operations';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { CallConsumer, RecordConsumer } from '../follower/consumers.ts';
import { followedPlaybooksOn } from '../follower/followed-playbooks.ts';
import { passOf, type PassParts } from '../follower/playbook-pass.ts';
import type { ListenerRow } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

export const playbookKey = 'playbook/acme/alpha/';

export type PassedOver = Pick<PassParts, 'records' | 'consumers' | 'calls' | 'passedEarly'> &
  Partial<Pick<PassParts, 'applyDefinitionRecord'>>;

export function recordAt(stream: string, position: number): RecordedEvent {
  return {
    id: `record-${position}`,
    cursor: `cursor-${position}`,
    causationId: null,
    correlationId: null,
    stream: `${playbookKey}${stream}`,
    version: 1,
    globalPosition: position,
    type: 'note_written',
    data: null,
    context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
}

export function finishedAt(position: number): RecordedEvent {
  const runId = `0199a3c4-7d2e-7c1a-9b3f-${String(position).padStart(12, '0')}`;
  return {
    ...recordAt(`runs/${runId}`, position),
    type: 'run_succeeded',
    data: { output: null, record: {} },
    context: {
      at: '2026-10-01T09:00:00.000Z',
      by: 'acme-admin',
      runId,
      definitionType: 'workflow',
      definitionName: 'check',
      definitionVersion: 1,
    },
  };
}

export function lastPageOf(page: (read: number) => Effect.Effect<readonly RecordedEvent[]>): PassParts['records'] {
  let reads = 0;
  return {
    after: () =>
      Effect.suspend(() => {
        reads += 1;
        return Effect.map(page(reads), (records) => ({
          records,
          hasMore: false,
          nextCursor: null,
          lastExamined: null,
        }));
      }),
  };
}

export function finishesRead(read: Effect.Effect<void> = Effect.void): CallConsumer {
  return {
    types: ['run_succeeded'],
    read: () => ({
      name: 'endings',
      skippedAfterSweeps: Number.POSITIVE_INFINITY,
      batchOf: () => Effect.as(read, { deliveries: [], through: undefined, more: false }),
    }),
  };
}

export function deliveringEach(delivered: (id: string) => void): RecordConsumer {
  return {
    name: 'noting',
    skippedAfterSweeps: 20,
    batchOf: (followed) =>
      Effect.succeed({
        deliveries: [
          {
            key: followed.record.id,
            workflow: 'note',
            deliver: Effect.sync(() => {
              delivered(followed.record.id);
            }),
            skipped: Function.constant(Effect.void),
          },
        ],
        through: followed.record.id,
        more: false,
      }),
  };
}

export function listenerFor(type: string): ListenerRow {
  return {
    runKey: 'acme/alpha/r-1',
    listener: 'wait',
    playbookKey,
    streamId: `${playbookKey}run-logs/r-1`,
    armedBy: 1,
    filters: JSON.stringify([{ type }]),
    workflow: 'wait',
    version: 1,
    passed: true,
  };
}

export async function passingOn(over: (database: HostDatabase) => PassedOver) {
  const opened = await openedOn(await onSQLite());
  const playbooks = followedPlaybooksOn(opened);
  const pass = passOf({
    database: opened,
    playbooks,
    definitionType: 'workflow',
    applyDefinitionRecord: Function.constant(Effect.succeed('applied')),
    unreadable: Function.constant(Effect.void),
    registered: [],
    ...over(opened),
  });
  return { database: opened, playbooks, pass };
}
