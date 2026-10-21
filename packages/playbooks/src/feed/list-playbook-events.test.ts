import { describe, expect, it } from 'vitest';

import { defineListPlaybookEvents } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { asQueryString, toPlaybook } from '../testing/harness.ts';
import {
  playbookFeed,
  playbookWithEvents,
  everyText,
  listPlaybookEvents,
  presenterOf,
  textsIn,
  textsOf,
  toAlpha,
  withCursor,
} from '../testing/playbook-feed.ts';

describe('list_playbook_events', () => {
  it('is a playbook query at GET /events whose type names the public types of its presenters', () => {
    expect(listPlaybookEvents.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      title: 'List playbook events',
      route: { method: 'GET', path: '/events' },
      reasons: ['invalid_input'],
      input: {
        schema: {
          properties: { type: { enum: ['note_added', 'note_kept', 'shelf_filled', 'run_moved', 'run_stepped'] } },
        },
      },
    });
    expect(listPlaybookEvents.registration.description).toContain(
      "The playbook's own creation, update and retirement are not among the events",
    );
  });

  it('says that its pages are read on only as the person needs', () => {
    expect(listPlaybookEvents.registration.description).toContain(
      'and `cursor` is the next_cursor of the page before, to read on only as the person needs.',
    );
  });

  it('needs a presenter that shows at least one type of event', () => {
    expect(() => defineListPlaybookEvents([presenterOf('notes', { added: null })])).toThrow(
      'The events of a playbook need a presenter that shows at least one type of event',
    );
  });
});

describe('the events list_playbook_events reads', () => {
  it('reads what the playbook recorded newest first, hiding what no presenter shows', async () => {
    const { reading } = await playbookWithEvents();

    expect(textsIn(await reading())).toEqual(['e', 'b', 'a']);
    expect(await reading({ limit: 1 })).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            type: 'note_kept',
            summary: 'Something happened.',
            data: { text: 'e' },
            metadata: {
              stream: 'playbook/acme/alpha/notes',
              position: 3,
              at: '2026-10-01T09:05:00.000Z',
              by: 'acme-admin',
            },
          },
        ],
        has_more: true,
      },
    });
  });

  it('reads oldest first, and from a query string', async () => {
    const { callInPlaybook } = await playbookWithEvents();

    expect(
      textsIn(
        await callInPlaybook(listPlaybookEvents, asQueryString(toAlpha(acmeAdmin, { order: 'asc', limit: '5' }))),
      ),
    ).toEqual(['a', 'b', 'e']);
  });
});

describe('the events of a playbook of one type', () => {
  it('are those its presenter shows under that name, though another kind stores the same type', async () => {
    const { reading } = await playbookWithEvents();

    expect([
      textsIn(await reading({ type: 'note_added' })),
      textsIn(await reading({ type: 'shelf_filled' })),
      textsIn(await reading({ type: 'note_kept' })),
    ]).toEqual([['a'], ['b'], ['e']]);
  });

  it('are looked for beyond the limit of a page, up to a thousand records', async () => {
    const { reading } = await playbookWithEvents();

    expect(textsOf(await reading({ type: 'note_kept', order: 'asc', limit: 1 })).output).toEqual({
      events: [{ data: { text: 'e' } }],
      has_more: false,
      next_cursor: null,
    });
  });

  it('leave a page they empty with a cursor', async () => {
    const { reading } = await playbookWithEvents();

    expect(textsOf(await reading({ type: 'note_added', limit: 2 })).output).toMatchObject({
      events: [],
      has_more: true,
    });
  });

  it('are refused for a type no presenter shows', async () => {
    const { reading } = await playbookWithEvents();

    expect(await reading({ type: 'added' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/type' }],
    });
  });
});

describe('the events of a playbook since a time', () => {
  it('are those it recorded from then on, in either order', async () => {
    const { reading } = await playbookWithEvents();

    expect([
      textsIn(await reading({ since: '2026-10-01T09:03:00Z' })),
      textsIn(await reading({ since: '2026-10-01T09:02:00Z', order: 'asc' })),
    ]).toEqual([['e'], ['b', 'e']]);
  });
});

describe('paging through the events of a playbook', () => {
  it('delivers every event once in either order while the playbook records more', async () => {
    const newest = await playbookWithEvents();
    const oldest = await playbookWithEvents();

    const newestFirst = await everyText(
      (cursor) => newest.reading({ limit: 1, ...withCursor(cursor) }),
      () => newest.recording('notes', 'added', 'more'),
    );
    const oldestFirst = await everyText(
      (cursor) => oldest.reading({ order: 'asc', limit: 2, ...withCursor(cursor) }),
      () => oldest.recording('notes', 'added', 'more'),
    );

    expect(newestFirst).toEqual(['e', 'b', 'a']);
    expect(oldestFirst).toEqual(['a', 'b', 'e', 'more', 'more', 'more']);
  });

  it('refuses a cursor that does not decode or that another playbook gave', async () => {
    const { callInPlaybook, reading, recording } = await playbookWithEvents();
    await recording('notes', 'added', 'x', 'playbook/globex/gamma');
    await recording('notes', 'added', 'y', 'playbook/globex/gamma');
    const ofGamma = textsOf(
      await callInPlaybook(listPlaybookEvents, toPlaybook('globex', 'gamma')(globexAdmin, { limit: 1 })),
    );

    expect([
      await reading({ cursor: 'not-a-cursor' }),
      await reading({ cursor: String(ofGamma.output.next_cursor) }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
    ]);
  });
});

describe('the events of a retired playbook', () => {
  it('stay readable', async () => {
    const { callInPlaybook, recording } = playbookFeed();
    await recording('notes', 'added', 'kept for good', 'playbook/acme/old');

    expect(textsIn(await callInPlaybook(listPlaybookEvents, toPlaybook('acme', 'old')(acmeAdmin)))).toEqual([
      'kept for good',
    ]);
  });
});
