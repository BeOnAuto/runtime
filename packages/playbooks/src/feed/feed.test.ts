import {
  changingNothing,
  type Lineage,
  makeDispatcher,
  messageIdOf,
  type Presenter,
  ServedAsTool,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineGetEvent } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import {
  everyText,
  feedHolders,
  playbookFeed,
  presenterOf,
  textsIn,
  toAlpha,
  withCursor,
} from '../testing/playbook-feed.ts';

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

const decodeText = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

const calls: Presenter = {
  streamKind: 'calls',
  publicNames: { added: ['call_answered'] },
  present: ({ data }) => {
    const { text } = decodeText(data);
    const answered = { text, result: text.repeat(70_000), output: text.repeat(1_048_576) };
    return [{ type: 'call_answered', summary: 'A tool answered.', data: answered }];
  },
  changes: changingNothing(['added']),
};

const steps: Presenter = {
  streamKind: 'run-logs',
  publicNames: { moved: ['run_moved', 'run_stepped'] },
  present: ({ data }) => {
    const { text } = decodeText(data);
    return [
      { type: 'run_moved', summary: 'A run moved.', data: { text } },
      { type: 'run_stepped', summary: 'A run stepped.', data: { text: `${text}1` }, part: { number: 1, causedBy: 0 } },
    ];
  },
  changes: changingNothing(['moved']),
};

const getEvent = defineGetEvent([presenterOf('notes', { added: 'note_added' }), calls, steps], feedHolders);

const noteId = messageIdOf('playbook/acme/alpha/notes', 1);

const notAnEventId: unknown = expect.stringContaining('an underscore and a number from 1');

async function feedWithEvents() {
  const feed = playbookFeed();
  await feed.recording('notes', 'added', 'a');
  await feed.recording('run-logs/r1', 'moved', 'x');
  await feed.recording('calls/c1', 'added', 'y');
  return feed;
}

describe('one event read whole', () => {
  it('is the event as a page shows it, by its id', async () => {
    const feed = await feedWithEvents();

    expect(await feed.callInPlaybook(getEvent, toAlpha(acmeAdmin, { event_id: noteId.toUpperCase() }))).toMatchObject({
      status: 'succeeded',
      output: {
        id: noteId,
        type: 'note_added',
        data: { text: 'a' },
        metadata: { stream: 'playbook/acme/alpha/notes', position: 1, by: 'acme-admin' },
      },
    });
  });

  it("is a workflow's step by its record's id and its number, caused by its record", async () => {
    const feed = await feedWithEvents();
    const recordId = messageIdOf('playbook/acme/alpha/run-logs/r1', 1);

    expect(await feed.callInPlaybook(getEvent, toAlpha(acmeAdmin, { event_id: `${recordId}_1` }))).toMatchObject({
      status: 'succeeded',
      output: { id: `${recordId}_1`, type: 'run_stepped', metadata: { causation_id: recordId } },
    });
  });

  it('holds every field whole over HTTP, and a result or an output past 64 KiB as its size as a tool', async () => {
    const feed = await feedWithEvents();
    const request = toAlpha(acmeAdmin, { event_id: messageIdOf('playbook/acme/alpha/calls/c1', 1) });
    const asTool = await feed.run(
      makeDispatcher([])
        .dispatchToPlaybook(getEvent.registration, request)
        .pipe(Effect.provideService(ServedAsTool, true)),
    );

    expect(await feed.callInPlaybook(getEvent, request)).toMatchObject({
      output: { data: { text: 'y', result: 'y'.repeat(70_000), output: 'y'.repeat(1_048_576) } },
    });
    expect(asTool).toMatchObject({ output: { data: { text: 'y', result_bytes: 70_002, output_bytes: 1_048_578 } } });
  });
});

describe('an event that cannot be read', () => {
  it('is not found when no event of the playbook has the id, or the record has no such step', async () => {
    const feed = await feedWithEvents();
    const unknown = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
    const ofAnotherPlaybook = toPlaybook('globex', 'gamma')(globexAdmin, { event_id: noteId });

    expect([
      await feed.callInPlaybook(getEvent, toAlpha(acmeAdmin, { event_id: unknown })),
      await feed.callInPlaybook(getEvent, toAlpha(acmeAdmin, { event_id: `${noteId}_1` })),
      await feed.callInPlaybook(getEvent, ofAnotherPlaybook),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found', detail: `The playbook holds no event ${unknown}` },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
  });

  it('is refused for an id that is not the id of an event, a step numbered from 0 or with a leading zero, or a slash', async () => {
    const feed = await feedWithEvents();
    const refused = ['note-1', `${noteId}_0`, `${noteId}_02`, `${noteId}/1`, `${noteId}_1234567`];

    expect(
      await Promise.all(refused.map((id) => feed.callInPlaybook(getEvent, toAlpha(acmeAdmin, { event_id: id })))),
    ).toMatchObject(
      refused.map(() => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/event_id', detail: notAnEventId }],
      })),
    );
  });
});

describe('the plain language of get_event', () => {
  it('names the event it reads, and says what it found', () => {
    const words = getEvent.registration.plainLanguage;

    expect([
      words?.attempt({ event_id: noteId }),
      words?.outcome(
        {
          id: noteId,
          type: 'note_added',
          summary: 'A note was added.',
          data: {},
          metadata: {
            stream: 'playbook/acme/alpha/notes',
            position: 1,
            global_position: 1,
            correlation_id: null,
            causation_id: null,
            at: '2026-10-01T09:00:00.000Z',
            by: 'acme-admin',
          },
        },
        { event_id: noteId },
      ),
    ]).toEqual([`read the event ${noteId}`, 'Found the note_added event, whole: A note was added.']);
  });
});
