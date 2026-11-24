import { makeDispatcher } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { defineListEventLines } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { listPlaybookEvents, playbookWithEvents, presenterOf, toAlpha } from '../testing/playbook-feed.ts';

const notes = presenterOf('notes', { added: 'note_added', hidden: null, kept: 'note_kept' });

const shelves = presenterOf('shelves', { added: 'shelf_filled' });

const listEventLines = defineListEventLines([notes, shelves]);

describe('list_event_lines', () => {
  it('is a playbook query served over HTTP alone at GET /event-lines', () => {
    expect(listEventLines.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'list_event_lines',
      title: 'List event lines',
      route: { method: 'GET', path: '/event-lines' },
      reasons: ['invalid_input'],
      servedOverHttpAlone: { kind: 'none' },
      input: { schema: { properties: { type: { enum: ['note_added', 'note_kept', 'shelf_filled'] } } } },
    });
  });

  it('needs a presenter that shows at least one type of event', () => {
    expect(() => defineListEventLines([presenterOf('notes', { added: null })])).toThrow(
      'The events of a playbook need a presenter that shows at least one type of event',
    );
  });

  it('is stale on any event of the feed', () => {
    expect(listEventLines.registration.staleOn).toEqual([{ kind: 'event' }]);
  });
});

describe('the lines list_event_lines reads', () => {
  const inputs: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
    ['none', {}],
    ['a limit', { limit: 1 }],
    ['oldest first', { order: 'asc' }],
    ['a type', { type: 'note_kept' }],
    ['a time', { since: '2026-10-01T09:02:00.000Z' }],
  ];

  it.each(inputs)('are the events list_playbook_events reads for the same input: %s', async (_named, input) => {
    const { run, callInPlaybook } = await playbookWithEvents();
    const lines = await run(
      makeDispatcher([]).dispatchToPlaybook(listEventLines.registration, toAlpha(acmeAdmin, input)),
    );

    expect(lines).toMatchObject({ status: 'succeeded' });
    expect(lines).toEqual(await callInPlaybook(listPlaybookEvents, toAlpha(acmeAdmin, input)));
  });

  it('are refused for a type no presenter shows', async () => {
    const { run } = await playbookWithEvents();
    const refused = makeDispatcher([]).dispatchToPlaybook(
      listEventLines.registration,
      toAlpha(acmeAdmin, { type: 'secret_added' }),
    );

    expect(await run(refused)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
  });
});
