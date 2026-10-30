import { PlaybookReader, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { NoteSchema, notebook, plainly } from './notebook.ts';

export const findNotes = defineQuery('playbook', {
  name: 'find_notes',
  title: 'Find notes',
  description: 'Finds the notes that hold every word given. Use it to look a note up. list_notes lists them all.',
  route: { method: 'POST', path: '/notes/found' },
  inputSchema: Schema.Struct({ words: Schema.Array(Schema.String) }),
  outputSchema: Schema.Struct({ notes: Schema.Array(NoteSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ words }) {
    const { state } = yield* (yield* PlaybookReader).load('notes', notebook);
    return { notes: state.filter(({ text }) => words.every((word) => text.includes(word))) };
  }),
  plainLanguage: plainly('find notes'),
});
