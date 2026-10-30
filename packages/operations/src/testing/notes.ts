import { Effect, Result, Schema } from 'effect';

import {
  PlaybookReader,
  PlaybookWriter,
  Conflict,
  NotFound,
  defineCommand,
  defineQuery,
  ActedContextSchema,
  factOf,
  textOfContent,
  type Decider,
  type RecordedSelection,
} from '../index.ts';
import { testedContext } from './callers.ts';

const NoteName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

const noteFields = { name: NoteName, text: Schema.String };

const NoteSchema = Schema.Struct(noteFields).annotate({ identifier: 'Note' });

type Note = typeof NoteSchema.Type;

const NoteAddedSchema = factOf('note_added', NoteSchema, ActedContextSchema);

type NoteAdded = typeof NoteAddedSchema.Type;

const notebook: Decider<readonly Note[], Note, NoteAdded, 'conflict'> = {
  initialState: [],
  evolve: (notes, { data }) => [...notes, data],
  decide: (note, notes) =>
    notes.some(({ name }) => name === note.name)
      ? Result.fail(new Conflict({ detail: `A note named ${note.name} exists` }))
      : Result.succeed([{ type: 'note_added', data: note }]),
  context: () => testedContext,
  eventSchema: NoteAddedSchema,
};

const Added = Schema.Struct({ added: NoteSchema, version: Schema.Int });

export const addNote = defineCommand('playbook', {
  name: 'add_note',
  title: 'Add note',
  description: 'Adds a note to the playbook.',
  route: { method: 'POST', path: '/notes' },
  successStatus: 201,
  inputSchema: Schema.Struct(noteFields),
  outputSchema: Added,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (note) {
    const { version } = yield* (yield* PlaybookWriter).execute('notes', notebook, note);
    return { added: note, version };
  }),
});

export const listNotes = defineQuery('playbook', {
  name: 'list_notes',
  title: 'List notes',
  description: 'Lists the notes of the playbook.',
  route: { method: 'GET', path: '/notes' },
  inputSchema: Schema.Struct({
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  }),
  outputSchema: Schema.Struct({ notes: Schema.Array(NoteSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ limit }) {
    const { state } = yield* (yield* PlaybookReader).load('notes', notebook);
    return { notes: state.slice(0, limit) };
  }),
});

export const getNote = defineQuery('playbook', {
  name: 'get_note',
  title: 'Get note',
  description: 'Reads one note of the playbook.',
  route: { method: 'GET', path: '/notes/{name}' },
  inputSchema: Schema.Struct({ name: NoteName }),
  outputSchema: NoteSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ name }) {
    const { state } = yield* (yield* PlaybookReader).load('notes', notebook);
    const found = state.find((note) => note.name === name);
    if (found === undefined) {
      return yield* new NotFound({ detail: `There is no note ${name}` });
    }
    return found;
  }),
});

export const copyNote = defineCommand('playbook', {
  name: 'copy_note',
  title: 'Copy note',
  description: 'Adds a note with the text of another note.',
  route: { method: 'POST', path: '/notes/{name}/copies' },
  successStatus: 201,
  inputSchema: Schema.Struct({ name: NoteName, copy: NoteName }),
  outputSchema: Added,
  reasons: ['not_found', 'conflict'],
  handle: Effect.fnUntraced(function* ({ name, copy }) {
    const { text } = yield* getNote.call({ name });
    return yield* addNote.call({ name: copy, text });
  }),
});

function selectionOf(run: string | undefined, correlation: string | undefined): RecordedSelection {
  if (run !== undefined) {
    return { kind: 'run', run };
  }
  return correlation === undefined ? { kind: 'everything' } : { kind: 'correlated', correlation };
}

export const readNoteHistory = defineQuery('playbook', {
  name: 'read_note_history',
  title: 'Read note history',
  description: 'Reads one page of what the playbook recorded, oldest first, taking any limit and time it is given.',
  route: { method: 'GET', path: '/note-history' },
  inputSchema: Schema.Struct({
    limit: Schema.Int,
    cursor: Schema.optionalKey(Schema.String),
    since: Schema.optionalKey(Schema.String),
    run: Schema.optionalKey(Schema.String),
    correlation: Schema.optionalKey(Schema.String),
  }),
  outputSchema: Schema.Struct({
    streams: Schema.Array(Schema.String),
    ids: Schema.Array(Schema.String),
    next_cursor: Schema.NullOr(Schema.String),
  }),
  reasons: ['invalid_input'],
  handle: Effect.fnUntraced(function* ({ limit, cursor, since, run, correlation }) {
    const { records, nextCursor } = yield* (yield* PlaybookReader).readRecorded(selectionOf(run, correlation), {
      order: 'asc',
      limit,
      ...(cursor === undefined ? {} : { cursor }),
      ...(since === undefined ? {} : { since }),
    });
    return { streams: records.map(({ stream }) => stream), ids: records.map(({ id }) => id), next_cursor: nextCursor };
  }),
});

export const readNoteEvent = defineQuery('playbook', {
  name: 'read_note_event',
  title: 'Read note event',
  description: 'Reads one event the playbook recorded, by its id.',
  route: { method: 'GET', path: '/note-events/{id}' },
  inputSchema: Schema.Struct({ id: Schema.String }),
  outputSchema: Schema.Struct({ stream: Schema.NullOr(Schema.String), by: Schema.NullOr(Schema.String) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ id }) {
    const record = yield* (yield* PlaybookReader).readRecordedEvent(id);
    return record === undefined ? { stream: null, by: null } : { stream: record.stream, by: record.context.by };
  }),
});

export const readNoteContent = defineQuery('playbook', {
  name: 'read_note_content',
  title: 'Read note content',
  description: 'Reads a content the playbook recorded, by its digest.',
  route: { method: 'GET', path: '/note-contents/{sha256}' },
  inputSchema: Schema.Struct({ sha256: Schema.String }),
  outputSchema: Schema.Struct({ text: Schema.NullOr(Schema.String) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ sha256 }) {
    const content = yield* (yield* PlaybookReader).readContent(sha256);
    return { text: content === undefined ? null : yield* textOfContent(content) };
  }),
});
