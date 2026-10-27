import type { RecordedEvent, RecordedPage } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { definitionRecordsKeepingTheirOwnStops } from '../reaction-testing/own-stops.ts';
import {
  deliveringEach,
  finishedAt,
  finishesRead,
  lastPageOf,
  listenerFor,
  passingOn,
  playbookKey,
  recordAt,
} from '../reaction-testing/playbook-passes.ts';
import { eventTrigger } from '../reaction-testing/playbook-writes.ts';
import type { PassParts } from './playbook-pass.ts';

const at = '2026-10-01T09:00:00.000Z';

function triggerActivatedAt(position: number): RecordedEvent {
  return {
    ...recordAt('definitions/workflow', position),
    type: 'definition_created',
    data: {
      content: { source: 'schedule: {}', triggers: [eventTrigger({ type: 'run_succeeded' })] },
      created_by: { id: 'acme-admin', name: 'acme-admin' },
    },
    context: { at, by: 'acme-admin', definitionType: 'workflow', definitionName: 'close', definitionVersion: 1 },
  };
}

function notedAt(position: number, delivers: ReadonlySet<string>): RecordedEvent {
  const event = { specversion: '1.0', id: `e${position}`, source: '/acme', type: 'com.acme.noted', time: at };
  return {
    ...recordAt(`events/e${position}`, position),
    type: 'event_published',
    data: delivers.has('event_published') ? { event, filled: [] } : null,
  };
}

function pagesOf(pageAt: (read: number, delivers: ReadonlySet<string>) => Effect.Effect<RecordedPage>) {
  const reads = { count: 0 };
  const records: PassParts['records'] = {
    after: (_playbook, _cursor, delivers) =>
      Effect.suspend(() => {
        reads.count += 1;
        return pageAt(reads.count, delivers);
      }),
  };
  return records;
}

function pageOf(records: readonly RecordedEvent[], hasMore: boolean): RecordedPage {
  return { records, hasMore, nextCursor: null, lastExamined: null };
}

function namedWhileTheSecondPageIsRead(database: HostDatabase) {
  const named = Effect.orDie(insertedListener(database, listenerFor('com.acme.noted')));
  return pagesOf((read, delivers) => {
    if (read <= 2) {
      return Effect.succeed(pageOf([finishedAt(1)], true));
    }
    const page = Effect.succeed(pageOf([notedAt(2, delivers)], false));
    return read === 3 ? Effect.andThen(named, page) : page;
  });
}

async function passedTwice(over: Parameters<typeof passingOn>[0]) {
  const { playbooks, pass } = await passingOn(over);
  await Effect.runPromise(playbooks.follow(playbookKey, null));
  const ends = [
    await Effect.runPromise(pass(playbookKey, 'signal')),
    await Effect.runPromise(pass(playbookKey, 'signal')),
  ];
  return { ends, cursor: (await Effect.runPromise(playbooks.load(playbookKey)))?.cursor };
}

describe('a pass that meets a definition activating a trigger of a type it reads already', () => {
  it('hands the next record of that type to the consumers of the reactions', async () => {
    const delivered: string[] = [];
    const { playbooks, pass } = await passingOn((database) => ({
      records: lastPageOf(() => Effect.succeed([finishedAt(1), triggerActivatedAt(2), finishedAt(3)])),
      consumers: [
        deliveringEach((id) => {
          delivered.push(id);
        }),
      ],
      calls: [finishesRead()],
      passedEarly: () => Effect.void,
      applyDefinitionRecord: definitionRecordsKeepingTheirOwnStops(database),
    }));
    await Effect.runPromise(playbooks.follow(playbookKey, null));

    await Effect.runPromise(pass(playbookKey, 'signal'));

    expect(delivered).toEqual(['record-3']);
  });
});

describe('a pass that meets an event of a type named after the page that holds it was read', () => {
  it('reads it again with its data rather than pass over it, and hands it to the consumers of the reactions', async () => {
    const delivered: string[] = [];

    const passed = await passedTwice((database) => ({
      records: namedWhileTheSecondPageIsRead(database),
      consumers: [
        deliveringEach((id) => {
          delivered.push(id);
        }),
      ],
      calls: [finishesRead()],
      passedEarly: () => Effect.void,
    }));

    expect([passed, delivered]).toEqual([{ ends: ['more', 'caught_up'], cursor: 'cursor-2' }, ['record-2']]);
  });
});
