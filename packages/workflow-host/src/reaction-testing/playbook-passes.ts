import type { RecordedEvent } from '@on.auto/operations';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { CallConsumer, RecordConsumer } from '../follower/consumers.ts';
import { followedOrgsOn } from '../follower/followed-orgs.ts';
import { passesOf, type PassParts } from '../follower/org-pass.ts';
import { factPayloadsOn } from '../ledger-testing/ledger-connections.ts';
import type { ListenerRow } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

export const playbookKey = 'playbook/acme/alpha/';

export const org = 'acme';

export const placeOfTheTests = 'cursor-0';

export type PassedOver = Pick<PassParts, 'records' | 'consumers' | 'calls' | 'passedEarly'> &
  Partial<Pick<PassParts, 'applyDefinitionRecord' | 'names' | 'registered'>>;

export function namesPlacingInAlpha(definitionKey: string): PassParts['names'] {
  const placed = new Map([
    [
      definitionKey,
      { definitionKey, playbookKey, definitionType: 'workflow', name: 'close', status: 'active', hasTriggers: true },
    ],
  ]);
  return { nameHeldBy: (key) => Promise.resolve(placed.get(key)) };
}

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
    name: 'endings',
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

export function passesOn(opened: HostDatabase, over: (database: HostDatabase) => PassedOver) {
  const orgs = followedOrgsOn(opened);
  const passes = passesOf({
    database: opened,
    orgs,
    names: opened.store,
    definitionType: 'workflow',
    applyDefinitionRecord: Function.constant(Effect.succeed('applied')),
    unreadable: Function.constant(Effect.void),
    contentMissing: Function.constant(Effect.void),
    factPayloadsOf: factPayloadsOn(opened),
    registered: [],
    holdsUnreadable: false,
    now: Date.now,
    holdNotes: {
      tried: Function.constant(Effect.void),
      failed: Function.constant(Effect.void),
      lifted: Function.constant(Effect.void),
    },
    ...over(opened),
  });
  return { database: opened, orgs, pass: passes.org, held: passes.held };
}

export async function passingOn(over: (database: HostDatabase) => PassedOver) {
  return passesOn(await openedOn(await onSQLite()), over);
}
