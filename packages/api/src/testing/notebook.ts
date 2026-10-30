import {
  ActedContextSchema,
  PlaybookIdSchema,
  PlaybookReader,
  PlaybookWriter,
  Conflict,
  InvalidInput,
  NotFound,
  OrgReader,
  OrgWriter,
  Unavailable,
  UnavailableKindSchema,
  defineCommand,
  defineQuery,
  factOf,
  quoted,
  type Decider,
  type Issue,
  type PlainLanguage,
} from '@on.auto/operations';
import { Effect, Function, Result, Schema } from 'effect';

const NoteName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

export const NoteSchema = Schema.Struct({ name: NoteName, text: Schema.String });

type Note = typeof NoteSchema.Type;

const Nothing = Schema.Record(Schema.String, Schema.Never);

const NoteAddedSchema = factOf('note_added', Schema.Struct({ note: NoteSchema }), ActedContextSchema);

type NoteAdded = typeof NoteAddedSchema.Type;

const writtenNow = { at: '2026-10-01T09:00:00.000Z', by: 'notebook' };

export const notebook: Decider<readonly Note[], Note, NoteAdded, 'conflict'> = {
  initialState: [],
  evolve: (notes, { data }) => [...notes, data.note],
  decide: (note, notes) =>
    notes.some(({ name }) => name === note.name)
      ? Result.fail(new Conflict({ detail: `A note named ${note.name} exists` }))
      : Result.succeed([{ type: 'note_added', data: { note } }]),
  context: () => writtenNow,
  eventSchema: NoteAddedSchema,
};

export function plainly(task: string): PlainLanguage<unknown, unknown> {
  return { task, attempt: () => task, outcome: () => `Done: ${task}.` };
}

export const addNote = defineCommand('playbook', {
  name: 'add_note',
  title: 'Add note',
  description: 'Adds a note to the playbook. Use it when the person dictates one. `name` names it and `text` says it.',
  route: { method: 'POST', path: '/notes' },
  successStatus: 201,
  inputSchema: NoteSchema,
  outputSchema: NoteSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (note) {
    yield* (yield* PlaybookWriter).execute('notes', notebook, note);
    return note;
  }),
  plainLanguage: {
    task: 'add a note',
    attempt: ({ name }) => `add the note ${quoted(name)}`,
    outcome: ({ name }) => `Added the note ${quoted(name)}.`,
  },
});

const listNotes = defineQuery('playbook', {
  name: 'list_notes',
  title: 'List notes',
  description: 'Lists the notes of the playbook. Use it to find a note. get_note reads one.',
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
  plainLanguage: plainly('list the notes'),
});

export const listNotesOfTheOrg = defineQuery('org', {
  name: 'list_notes',
  title: 'List notes',
  description: 'Lists where the notes are kept. Use it to find the notes. `playbook` keeps those of one playbook.',
  route: { method: 'GET', path: '/notes' },
  inputSchema: Schema.Struct({
    playbook: Schema.optionalKey(
      PlaybookIdSchema.annotate({ description: 'The playbook whose notes to list; every playbook without it' }),
    ),
  }),
  outputSchema: Schema.Struct({ kept_for: Schema.String }),
  reasons: [],
  handle: ({ playbook = 'the org' }) => Effect.succeed({ kept_for: playbook }),
  plainLanguage: plainly('list the notes'),
});

export const getNote = defineQuery('playbook', {
  name: 'get_note',
  title: 'Get note',
  description: 'Reads one note of the playbook. Use it when the note is named. `name` names it.',
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
  plainLanguage: {
    task: 'read a note',
    attempt: ({ name }) => `read the note ${quoted(name)}`,
    outcome: ({ name, text }) => `The note ${quoted(name)} says ${quoted(text)}.`,
  },
});

export const latestNote = defineQuery('playbook', {
  name: 'latest_note',
  title: 'Latest note',
  description: 'Reads the note added last. Use it when no note is named. list_notes lists them all.',
  route: { method: 'GET', path: '/notes/latest' },
  inputSchema: Nothing,
  outputSchema: NoteSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* () {
    const { state } = yield* (yield* PlaybookReader).load('notes', notebook);
    const latest = state.at(-1);
    if (latest === undefined) {
      return yield* new NotFound({ detail: 'The playbook has no notes' });
    }
    return latest;
  }),
  plainLanguage: {
    task: 'read a note',
    attempt: () => 'read the latest note',
    outcome: ({ name }) => `The latest note is ${quoted(name)}.`,
  },
});

const breakDown = defineQuery('playbook', {
  name: 'break_down',
  title: 'Break down',
  description: 'Fails with a defect. It answers nothing. It is for tests.',
  route: { method: 'GET', path: '/broken' },
  inputSchema: Nothing,
  outputSchema: Nothing,
  reasons: [],
  handle: () => Effect.die(new Error('database password is hunter2')),
  plainLanguage: plainly('break down'),
});

export function waitForeverAnnouncing(announce: () => void) {
  return defineQuery('playbook', {
    name: 'wait_forever',
    title: 'Wait forever',
    description: 'Never finishes on its own. It waits until it is stopped. It is for tests.',
    route: { method: 'GET', path: '/waiting' },
    inputSchema: Nothing,
    outputSchema: Nothing,
    reasons: [],
    handle: () => Effect.andThen(Effect.sync(announce), Effect.never),
    plainLanguage: plainly('wait forever'),
  });
}

const PlaybookLabelSchema = Schema.Struct({ playbook: PlaybookIdSchema, label: Schema.String });

type PlaybookLabel = typeof PlaybookLabelSchema.Type;

const PlaybookLabelledSchema = factOf(
  'playbook_labelled',
  Schema.Struct({ labelled: PlaybookLabelSchema }),
  ActedContextSchema,
);

type PlaybookLabelled = typeof PlaybookLabelledSchema.Type;

const labelBook: Decider<readonly PlaybookLabel[], PlaybookLabel, PlaybookLabelled> = {
  initialState: [],
  evolve: (labels, { data: { labelled } }) => [
    ...labels.filter(({ playbook }) => playbook !== labelled.playbook),
    labelled,
  ],
  decide: (labelled) => Result.succeed([{ type: 'playbook_labelled', data: { labelled } }]),
  context: () => writtenNow,
  eventSchema: PlaybookLabelledSchema,
};

const labelPlaybook = defineCommand('org', {
  name: 'label_playbook',
  title: 'Label playbook',
  description: 'Gives a playbook of the org a label. Use it to tell playbooks apart. `playbook` names the playbook.',
  route: { method: 'PUT', path: '/playbooks/{playbook}/label' },
  inputSchema: PlaybookLabelSchema,
  outputSchema: PlaybookLabelSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (labelled) {
    yield* (yield* OrgWriter).execute('playbook-labels', labelBook, labelled);
    return labelled;
  }),
  plainLanguage: plainly('label a playbook'),
});

const listLabels = defineQuery('org', {
  name: 'list_labels',
  title: 'List labels',
  description:
    'Lists the labels of the playbooks of the org. Use it to find a playbook by its label. label_playbook gives one.',
  route: { method: 'GET', path: '/playbook-labels' },
  inputSchema: Nothing,
  outputSchema: Schema.Struct({ labels: Schema.Array(PlaybookLabelSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    const { state } = yield* (yield* OrgReader).load('playbook-labels', labelBook);
    return { labels: state };
  }),
  plainLanguage: plainly('list the labels'),
});

const Line = Schema.String.annotate({ identifier: 'Line' });

const checkLines = defineCommand('playbook', {
  name: 'check_lines',
  title: 'Check lines',
  description:
    'Accepts lines that all start with a capital letter, and rejects every other line. Use it to check lines. `lines` are the lines.',
  route: { method: 'POST', path: '/lines' },
  inputSchema: Schema.Struct({ lines: Schema.Array(Line) }),
  outputSchema: Schema.Struct({ accepted: Schema.Int }),
  reasons: ['invalid_input'],
  handle: ({ lines }) => {
    const issues = lines.flatMap((line, index): readonly Issue[] =>
      /^[A-Z]/u.test(line)
        ? []
        : [{ detail: `Line ${index + 1} must start with a capital letter`, pointer: `/lines/${index}` }],
    );
    return issues.length === 0
      ? Effect.succeed({ accepted: lines.length })
      : Effect.fail(new InvalidInput({ detail: 'Some lines need fixing', issues }));
  },
  plainLanguage: plainly('check the lines'),
});

const becauseOfKind = {
  model_not_offered: { because: 'model_not_allowed' },
  tool_not_offered: { because: 'tool_not_listed' },
  tool_server_failed: { because: 'unreachable' },
  tools_unfinished: { because: 'model_unavailable' },
  rebuilding: {},
  requests_full: {},
  builds_full: {},
  dataset_not_ready: {},
  model_process_busy: {},
  model_process_failed: {},
  meter_unavailable: {},
} as const;

const sendNotes = defineCommand('playbook', {
  name: 'send_notes',
  title: 'Send notes',
  description:
    'Sends the notes nowhere, and says why it could not, by the kind it is given. It never succeeds. It is for tests.',
  route: { method: 'POST', path: '/notes/sending' },
  inputSchema: Schema.Struct({ kind: UnavailableKindSchema }),
  outputSchema: Nothing,
  reasons: ['unavailable'],
  handle: ({ kind }) =>
    Effect.fail(new Unavailable({ detail: 'The notes could not be sent', kind, ...becauseOfKind[kind] })),
  plainLanguage: plainly('send the notes'),
});

export function notebookOperationsAnnouncingWaits(announce: () => void) {
  const waitForever = waitForeverAnnouncing(announce);
  return [
    addNote,
    checkLines,
    listNotes,
    getNote,
    latestNote,
    breakDown,
    waitForever,
    labelPlaybook,
    listLabels,
    sendNotes,
  ];
}

export const notebookOperations = notebookOperationsAnnouncingWaits(Function.constVoid);
