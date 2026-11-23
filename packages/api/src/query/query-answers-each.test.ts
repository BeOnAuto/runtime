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
