import { changingNothing, type Presenter } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { defineListPlaybookEvents } from '../index.ts';

const notes: Presenter = {
  streamKind: 'notes',
  publicNames: { added: ['note_added'] },
  present: () => [],
  changes: changingNothing(['added']),
};

const { plainLanguage } = defineListPlaybookEvents([notes]).registration;

const event = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  type: 'note_added',
  summary: 'A note was added.',
  data: {},
  metadata: {
    stream: 'playbook/acme/alpha/notes',
    position: 1,
    global_position: 7,
    correlation_id: null,
    causation_id: null,
    at: '2026-10-01T09:00:00.000Z',
    by: 'acme-admin',
  },
};

function found(events: readonly unknown[], request: object = {}, hasMore = false): string | undefined {
  return plainLanguage?.outcome({ events, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null }, request);
}

describe('the plain language of list_playbook_events', () => {
  it('says how many events it found, of what kind, since when and in which order', () => {
    expect([
      found([event, event]),
      found([event], { type: 'note_added', since: '2026-10-01T09:00:00Z', order: 'asc' }, true),
      found(Array.from({ length: 100 }, () => event)),
      found([event], { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' }),
    ]).toEqual([
      'Found 2 events in this playbook, newest first, each with its fact and its metadata.',
      'Found 1 event of the kind asked for in this playbook since the time given, oldest first, each with its fact and its metadata. More remain after these.',
      'Found one hundred events in this playbook, newest first, each with its fact and its metadata.',
      'Found 1 event of the run asked for in this playbook, newest first, each with its fact and its metadata.',
    ]);
  });

  it('says when nothing has happened, nothing more, or nothing on this page', () => {
    expect([
      found([]),
      found([], { since: '2026-10-01T09:00:00Z' }),
      found([], { type: 'note_added', cursor: 'WyJicmFpbiJd' }),
      found([], { type: 'note_added' }, true),
      found([], { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' }),
    ]).toEqual([
      'Nothing has happened in this playbook yet.',
      'Nothing has happened in this playbook since the time given.',
      'There is nothing more of the kind asked for to read in this playbook.',
      'This page shows nothing of the kind asked for, but there is more of this playbook to read.',
      'Nothing of the run asked for has happened in this playbook.',
    ]);
  });

  it('says what it tried', () => {
    expect([plainLanguage?.attempt({}), plainLanguage?.attempt({ type: 7 })]).toEqual([
      'read what happened in the playbook',
      'read what happened in the playbook',
    ]);
  });
});
