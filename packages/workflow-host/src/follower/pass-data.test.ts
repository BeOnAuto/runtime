import type { RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { followedPlaybooksOn } from './followed-playbooks.ts';
import { passOf, type PassParts } from './playbook-pass.ts';

const playbookKey = 'playbook/acme/alpha/';

interface CountedRecords {
  readonly records: PassParts['records'];
  readonly reads: () => readonly boolean[];
}

function recordAt(stream: string, position: number): RecordedEvent {
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

function countedRecords(pageAt: (read: number) => Effect.Effect<readonly RecordedEvent[]>): CountedRecords {
  const reads: boolean[] = [];
  return {
    records: {
      after: (_playbook, _cursor, delivers) =>
        Effect.suspend(() => {
          reads.push(delivers.size > 0);
          return Effect.map(pageAt(reads.length), (records) => ({
            records,
            hasMore: true,
            nextCursor: null,
            lastExamined: null,
          }));
        }),
    },
    reads: () => reads,
  };
}

function endlessNotes(): CountedRecords {
  return countedRecords((read) => Effect.succeed([recordAt(`notes/n${read}`, read)]));
}

function listening(database: HostDatabase, armedBy: number) {
  return insertedListener(database, {
    runKey: 'acme/alpha/r-1',
    listener: 'listener',
    playbookKey,
    streamId: `${playbookKey}run-logs/r-1`,
    armedBy,
    filters: '[{"type":"com.acme.noted"}]',
    workflow: 'wait',
    version: 1,
    passed: false,
  });
}

async function passing(counted: CountedRecords) {
  const opened = await openedOn(await onSQLite());
  const playbooks = followedPlaybooksOn(opened);
  const pass = passOf({
    database: opened,
    records: counted.records,
    playbooks,
    consumers: [],
    calls: [],
    definitionType: 'workflow',
    applyDefinitionRecord: () => Effect.succeed('applied'),
    unreadable: () => Effect.void,
    passedEarly: () => Effect.void,
    registered: [],
  });
  return { database: opened, playbooks, pass };
}

describe('the data of the records a pass reads', () => {
  it('is read again with it, after a glance without it, while a run of the playbook listens for a type of event', async () => {
    const counted = endlessNotes();
    const { database, playbooks, pass } = await passing(counted);
    await Effect.runPromise(playbooks.follow(playbookKey, null));
    await Effect.runPromise(Effect.orDie(listening(database, 7)));

    await Effect.runPromise(pass(playbookKey, 'signal'));

    expect(counted.reads().slice(0, 2)).toEqual([false, true]);
  });
});
