import { makeCatalog, type Outcome } from '@on.auto/operations';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { notebookOperations } from '../testing/notebook.ts';
import { queryAnswered, queryServingOf, type ReadsAnswered } from './query-answers.ts';
import type { ReadAsked } from './query-schema.ts';

const serving = queryServingOf(makeCatalog(notebookOperations), [
  { operation: 'list_labels', at: ['labels'], key: 'playbook' },
]);

const succeeded = (output: Readonly<Record<string, Schema.Json>>): Outcome => ({ status: 'succeeded', output });

function turnsLater(turns: number): Promise<void> {
  return turns === 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        setImmediate(resolve);
      }).then(() => turnsLater(turns - 1));
}

const ANSWERS: Readonly<Record<string, Outcome>> = {
  list_labels: succeeded({ labels: [{ playbook: 'alpha', label: 'A' }] }),
  list_notes: succeeded({ notes: [{ name: 'n1', text: 'one' }] }),
  latest_note: succeeded({ name: 'latest', text: 'of gamma' }),
};

function readsWithASlowOne() {
  const happened: string[] = [];
  const notesAsked = Promise.withResolvers<void>();
  const slow = Promise.race([notesAsked.promise, turnsLater(5)]).then(() => happened.push('latest_note answered'));
  const whenAsked = new Map([
    [
      'list_notes',
      () => {
        notesAsked.resolve();
      },
    ],
  ]);
  const answerOf = ({ registration: { name } }: ReadAsked): Promise<Outcome> => {
    happened.push(`${name} asked`);
    whenAsked.get(name)?.();
    const answer = ANSWERS[name] ?? succeeded({});
    return new Map([['latest_note', slow.then(() => answer)]]).get(name) ?? Promise.resolve(answer);
  };
  const answers: ReadsAnswered = (reads) => reads.map((read) => answerOf(read));
  return { happened, answers };
}

describe('a query whose reads of one level answer at different times', () => {
  it('reads below a read as soon as it is answered, while a slower read of its level is still under way', async () => {
    const { happened, answers } = readsWithASlowOne();

    const { body } = await queryAnswered(
      serving,
      { query: '{ list_labels { labels { list_notes { notes { name } } } } latest_note(playbook: "gamma") { text } }' },
      answers,
    );

    expect(body['data']).toEqual({
      list_labels: { labels: [{ list_notes: { notes: [{ name: 'n1' }] } }] },
      latest_note: { text: 'of gamma' },
    });
    expect(happened.indexOf('list_notes asked')).toBeLessThan(happened.indexOf('latest_note answered'));
  });
});

const listedNotes = (_item: unknown, _playbook: string, first: Readonly<Record<string, unknown>>) => {
  const listed = first['notes'];
  const notes: readonly unknown[] =
    typeof listed === 'object' && listed !== null && 'notes' in listed && Array.isArray(listed.notes)
      ? listed.notes
      : [];
  return notes.flatMap((note) =>
    typeof note === 'object' && note !== null && 'name' in note && typeof note.name === 'string'
      ? [{ name: note.name }]
      : [],
  );
};

const eachNoteListed = {
  operation: 'latest_note',
  scope: 'playbook' as const,
  at: [],
  reads: [
    {
      field: 'listed',
      operation: 'get_note',
      description: 'Each note listed, read whole',
      binds: ['name'],
      first: () => ({ notes: { operation: 'list_notes', input: { limit: 5 } } }),
      input: listedNotes,
      many: true,
    },
  ],
};

function noting(): { readonly asked: readonly string[]; readonly answers: ReadsAnswered } {
  const asked: string[] = [];
  const answers: ReadsAnswered = (reads) =>
    reads.map((read) => {
      asked.push(`${read.registration.name}@${String(read.playbook)}`);
      return Promise.resolve(ANSWERS[read.registration.name] ?? succeeded({ name: 'n1', text: 'one' }));
    });
  return { asked, answers };
}

describe('a query whose bound read needs another read first', () => {
  it('answers that read once where the query asks it too', async () => {
    const { asked, answers } = noting();

    const answered = await queryAnswered(
      queryServingOf(makeCatalog(notebookOperations), [eachNoteListed]),
      {
        query: `{
          latest_note(playbook: "gamma") { listed { name } }
          list_notes(playbook: "gamma", limit: 5) { notes { name } }
        }`,
      },
      answers,
    );

    expect(answered.status).toBe(200);
    expect(asked.filter((read) => read === 'list_notes@gamma')).toHaveLength(1);
    expect(asked).toContain('get_note@gamma');
  });
});
