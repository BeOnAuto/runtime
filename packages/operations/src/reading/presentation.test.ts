import { describe, expect, it } from 'vitest';

import { changingNothing } from '../changes/change-naming.ts';
import {
  presentationOf,
  streamKindOf,
  type PresentedFact,
  type Presenter,
  type RecordedEvent,
  type RecordedFact,
  type Showing,
} from '../index.ts';
import { nothingKept } from './kept-content.ts';

const at = '2026-10-05T09:00:00.000Z';

function recorded(stream: string, type: string): RecordedEvent {
  return {
    id: `${stream}:${type}`,
    cursor: `${stream}@${type}`,
    causationId: 'cause',
    correlationId: 'top',
    stream,
    version: 3,
    globalPosition: 42,
    type,
    data: {},
    context: { at, by: 'tester' },
    recordedAt: at,
  };
}

function shown({ type }: RecordedFact): PresentedFact {
  return { type: `shown_${type}`, summary: 'Something happened.', data: { text: 'small' } };
}

const notes: Presenter = {
  streamKind: 'notes',
  publicNames: { note_added: ['shown_note_added'], note_dropped: [], note_kept: ['shown_note_kept'] },
  present: (record) => [shown(record)],
  changes: changingNothing(['note_added', 'note_dropped', 'note_kept']),
};

const shelves: Presenter = {
  streamKind: 'shelves',
  publicNames: { shelf_filled: ['shown_shelf_filled', 'shown_shelf_counted'], note_added: ['shown_note_added'] },
  present: (record) => (record.stream.endsWith('/secret') ? [] : [shown(record)]),
  changes: changingNothing(['shelf_filled', 'note_added']),
};

const steps: Presenter = {
  streamKind: 'run-logs',
  publicNames: { input_applied: ['applied', 'stepped'] },
  present: (record, content) => [
    { type: 'applied', summary: 'An input was applied.', data: { answer: content(record.type) ?? null } },
    { type: 'stepped', summary: 'A step started.', data: {}, part: { number: 1, causedBy: 0 } },
    { type: 'stepped', summary: 'A step ended.', data: {}, part: { number: 2, causedBy: 1 } },
  ],
  changes: changingNothing(['input_applied']),
};

const presentation = presentationOf([notes, shelves, steps]);

const showing: Showing = {
  streamPrefix: 'playbook/acme/alpha/',
  content: nothingKept,
  view: 'page',
};

const metadata = {
  stream: 'playbook/acme/alpha/notes',
  position: 3,
  global_position: 42,
  correlation_id: 'top',
  causation_id: 'cause',
  at,
  by: 'tester',
};

describe('the kind of a stream', () => {
  it.each([
    ['runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', 'runs'],
    ['definitions/reasoning', 'definitions'],
    ['notes', 'notes'],
  ])('of %s is %s', (stream, kind) => {
    expect(streamKindOf(stream)).toBe(kind);
  });
});

describe('the presentation of what a playbook recorded', () => {
  it('presents a record by the presenter of its stream kind, with its id and its metadata', () => {
    expect(presentation.present(recorded('notes', 'note_added'), showing)).toEqual([
      {
        id: 'notes:note_added',
        type: 'shown_note_added',
        summary: 'Something happened.',
        data: { text: 'small' },
        metadata,
      },
    ]);
    expect(presentation.present(recorded('shelves/red', 'shelf_filled'), showing)).toEqual([
      {
        id: 'shelves/red:shelf_filled',
        type: 'shown_shelf_filled',
        summary: 'Something happened.',
        data: { text: 'small' },
        metadata: { ...metadata, stream: 'playbook/acme/alpha/shelves/red' },
      },
    ]);
  });

  it('names each part of a record by the record id and its number, and its cause by the part it names', () => {
    const record = recorded('run-logs/r1', 'input_applied');
    const rows = presentation.present(record, { ...showing, content: (sha256) => `content of ${sha256}` });

    expect(rows.map(({ id, metadata: { causation_id: cause } }) => [id, cause])).toEqual([
      ['run-logs/r1:input_applied', 'cause'],
      ['run-logs/r1:input_applied_1', 'run-logs/r1:input_applied'],
      ['run-logs/r1:input_applied_2', 'run-logs/r1:input_applied_1'],
    ]);
    expect(rows[0]?.data).toEqual({ answer: 'content of input_applied' });
  });
});

describe('the records a presentation shows', () => {
  it('hides a record of a kind without a presenter, of a type its presenter hides or does not know, or one its presenter hides', () => {
    expect(
      [
        recorded('definitions/reasoning', 'definition_created'),
        recorded('notes', 'note_dropped'),
        recorded('notes', 'note_burnt'),
        recorded('notes', 'constructor'),
        recorded('shelves/secret', 'shelf_filled'),
      ].map((record) => presentation.present(record, showing)),
    ).toEqual([[], [], [], [], []]);
  });

  it('names every public type once, and the stored types each stands for', () => {
    expect(presentation.publicTypes).toEqual([
      'shown_note_added',
      'shown_note_kept',
      'shown_shelf_filled',
      'shown_shelf_counted',
      'applied',
      'stepped',
    ]);
    expect(presentation.storedTypesOf('shown_note_added')).toEqual(['note_added']);
    expect(presentation.storedTypesOf('shown_shelf_filled')).toEqual(['shelf_filled']);
    expect(presentation.storedTypesOf('shown_shelf_counted')).toEqual(['shelf_filled']);
    expect(presentation.storedTypesOf('note_dropped')).toEqual([]);
  });

  it('refuses two presenters of one stream kind', () => {
    expect(() => presentationOf([notes, { ...shelves, streamKind: 'notes' }])).toThrow(
      new Error('More than one presenter presents the stream kind notes'),
    );
  });
});
