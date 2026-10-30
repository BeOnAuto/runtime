import type { Lineage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { playbookFeed, everyText, textsIn, withCursor } from '../testing/playbook-feed.ts';

const root = '0199A3C4-7D2E-7C1A-9B3F-2F1E0D9C8B7A';

const ofRoot: Lineage = { causationId: null, correlationId: root.toLowerCase() };

describe('the events of one run and the runs it started', () => {
  it('are those whose correlation is that run, in the order of the playbook, and none for a run another started', async () => {
    const feed = playbookFeed();
    await feed.recordingWith('notes', { type: 'added', data: { text: 'a' } }, ofRoot);
    await feed.recording('notes', 'added', 'b');
    await feed.recordingWith('shelves/red', { type: 'added', data: { text: 'c' } }, ofRoot);

    expect([
      textsIn(await feed.reading({ run_id: root })),
      textsIn(await feed.reading({ run_id: root, order: 'asc', type: 'note_added' })),
      textsIn(await feed.reading({ run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b' })),
    ]).toEqual([['c', 'a'], ['a'], []]);
  });

  it('are refused for an id that is not a UUID', async () => {
    const { reading } = playbookFeed();

    expect(await reading({ run_id: 'not-a-run' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/run_id' }],
    });
  });
});

describe('a page of the events of a playbook', () => {
  it('counts the events it answers, ends inside a record, and reads on from there in either order', async () => {
    const feed = playbookFeed();
    await feed.recording('run-logs/r1', 'moved', 'x');
    await feed.recording('run-logs/r1', 'moved', 'y');
    const read = (order: 'asc' | 'desc') => (cursor: string | undefined) =>
      feed.reading({ order, limit: 2, ...withCursor(cursor) });

    expect([
      await everyText(read('asc'), () => Promise.resolve()),
      await everyText(read('desc'), () => Promise.resolve()),
    ]).toEqual([
      ['x', 'x1', 'x2', 'y', 'y1', 'y2'],
      ['y2', 'y1', 'y', 'x2', 'x1', 'x'],
    ]);
  });

  it('of one type keeps only the events of that type a record shows', async () => {
    const feed = playbookFeed();
    await feed.recording('run-logs/r1', 'moved', 'x');

    expect(textsIn(await feed.reading({ type: 'run_stepped', order: 'asc' }))).toEqual(['x1', 'x2']);
  });
});
