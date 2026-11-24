import { makeCatalog } from '@on.auto/operations';
import { graphql, printSchema } from 'graphql';
import { describe, expect, it } from 'vitest';

import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { querySchemaOf, QueryReads } from './query-schema.ts';

const catalog = makeCatalog([...notebookOperations, listNotesOfTheOrg]);

const labelsListed = { operation: 'list_labels', at: ['labels'], key: 'playbook' };

function asked(answers: Readonly<Record<string, unknown>>) {
  const reads: { readonly operation: string; readonly playbook: string | undefined; readonly input: unknown }[] = [];
  const reading = new QueryReads((read) => {
    reads.push({ operation: read.registration.name, playbook: read.playbook, input: read.input });
    return Promise.resolve(answers[`${read.registration.name}@${String(read.playbook)}`]);
  });
  return { reads, reading };
}

const notesOfAList = {
  operation: 'list_notes',
  scope: 'playbook' as const,
  at: ['notes'],
  reads: [
    {
      field: 'the_note',
      operation: 'get_note',
      description: 'The note read whole, by its name',
      binds: ['name'],
      input: (item: Readonly<Record<string, unknown>>) =>
        typeof item['name'] === 'string' ? { name: item['name'] } : undefined,
    },
  ],
};

const namedInTheLatest = {
  operation: 'latest_note',
  scope: 'playbook' as const,
  at: [],
  reads: [
    {
      field: 'named_in_it',
      operation: 'get_note',
      description: 'Each note its text names',
      binds: ['name'],
      input: (item: Readonly<Record<string, unknown>>) =>
        String(item['text'])
          .split(' ')
          .map((name) => ({ name })),
      many: true,
    },
  ],
};

const bound = [labelsListed, notesOfAList, namedInTheLatest];

const notesOfTwoPlaybooks = {
  'list_labels@undefined': { labels: [{ playbook: 'alpha' }, { playbook: 'beta' }] },
  'list_notes@alpha': {
    notes: [
      { name: 'n1', text: 'one' },
      { name: 'odd', text: 'odd' },
    ],
  },
  'list_notes@beta': { notes: [{ name: 'n2', text: 'two' }] },
  'get_note@alpha': { name: 'n1', text: 'of alpha' },
  'get_note@beta': { name: 'n2', text: 'of beta' },
  'get_note@gamma': { name: 'n9', text: 'of gamma' },
  'latest_note@gamma': { name: 'n3', text: 'n1 n2' },
};

const notesOf = (texts: readonly string[]) => ({
  list_notes: { notes: texts.map((text) => ({ the_note: { text } })) },
});

describe('the reads bound to what a read answers', () => {
  it('gives an item of a read the reads its edge binds to it, asking only for what the item does not give', () => {
    const printed = printSchema(querySchemaOf(catalog, bound).schema);

    expect(printed).toContain('  """The note read whole, by its name"""\n  the_note: GetNoteAnswer\n');
    expect(printed).toContain('  """Each note its text names"""\n  named_in_it: [GetNoteAnswer]\n');
  });

  it('reads each bound read in the playbook of the answer its item is in, with the input the item gives and the arguments asked', async () => {
    const { schema } = querySchemaOf(catalog, bound);
    const { reads, reading } = asked(notesOfTwoPlaybooks);

    const answered = await graphql({
      schema,
      source: '{ list_labels { labels { list_notes(limit: 5) { notes { the_note { text } } } } } }',
      contextValue: reading,
    });

    expect(answered).toEqual({
      data: { list_labels: { labels: [notesOf(['of alpha', 'of alpha']), notesOf(['of beta'])] } },
    });
    expect(reads.filter(({ operation }) => operation !== 'list_labels')).toEqual([
      { operation: 'list_notes', playbook: 'alpha', input: { limit: 5 } },
      { operation: 'list_notes', playbook: 'beta', input: { limit: 5 } },
      { operation: 'get_note', playbook: 'alpha', input: { name: 'n1' } },
      { operation: 'get_note', playbook: 'alpha', input: { name: 'odd' } },
      { operation: 'get_note', playbook: 'beta', input: { name: 'n2' } },
    ]);
  });
});

describe('the reads bound to what a read answers, as a list', () => {
  it('reads a bound read once for each input its item gives, as a list', async () => {
    const { schema } = querySchemaOf(catalog, bound);
    const { reads, reading } = asked(notesOfTwoPlaybooks);

    const answered = await graphql({
      schema,
      source: '{ latest_note(playbook: "gamma") { named_in_it { text } } }',
      contextValue: reading,
    });

    expect(answered).toEqual({ data: { latest_note: { named_in_it: [{ text: 'of gamma' }, { text: 'of gamma' }] } } });
    expect(reads.slice(1)).toEqual([
      { operation: 'get_note', playbook: 'gamma', input: { name: 'n1' } },
      { operation: 'get_note', playbook: 'gamma', input: { name: 'n2' } },
    ]);
  });

  it('answers a bound read none where its item gives no input for it, and reads nothing for it', async () => {
    const { schema } = querySchemaOf(catalog, bound);
    const { reads, reading } = asked({ 'list_notes@alpha': { notes: [{ name: 7, text: 'odd' }] } });

    const answered = await graphql({
      schema,
      source: '{ list_notes(playbook: "alpha") { notes { the_note { text } } } }',
      contextValue: reading,
    });

    expect(answered).toEqual({ data: { list_notes: { notes: [{ the_note: null }] } } });
    expect(reads.map(({ operation }) => operation)).toEqual(['list_notes']);
  });
});

const latestOfEachLabel = {
  operation: 'list_labels',
  at: ['labels'],
  key: 'playbook',
  reads: [
    {
      field: 'its_latest',
      operation: 'latest_note',
      description: 'The latest note of the playbook the label names',
      binds: [],
      input: () => ({}),
    },
    {
      field: 'never',
      operation: 'a_read_the_catalog_lacks',
      description: 'Nothing',
      binds: [],
      input: () => ({}),
    },
  ],
};

describe('the reads bound to an item of an org’s read', () => {
  it('reads in the playbook the item’s key names, and none for an item that names none or is no object', async () => {
    const { schema } = querySchemaOf(catalog, [latestOfEachLabel, notesOfAList]);
    const { reads, reading } = asked({
      'list_labels@undefined': { labels: [{ playbook: 'alpha' }, { playbook: 7 }, {}] },
      'latest_note@alpha': { name: 'n1', text: 'of alpha' },
      'list_notes@beta': { notes: ['odd'] },
    });

    const answered = await graphql({
      schema,
      source: `{
        list_labels { labels { its_latest { text } } }
        list_notes(playbook: "beta") { notes { the_note { text } } }
      }`,
      contextValue: reading,
    });

    expect(answered).toEqual({
      data: {
        list_labels: { labels: [{ its_latest: { text: 'of alpha' } }, { its_latest: null }, { its_latest: null }] },
        list_notes: { notes: [{ the_note: null }] },
      },
    });
    expect(reads.map(({ operation, playbook }) => [operation, playbook])).toEqual([
      ['list_labels', undefined],
      ['list_notes', 'beta'],
      ['latest_note', 'alpha'],
    ]);
    expect(printSchema(schema)).not.toContain('never');
  });
});

interface Note {
  readonly name: string;
  readonly text: string;
}

const NOTES: readonly Note[] = [
  { name: 'n1', text: 'same' },
  { name: 'n2', text: 'other' },
  { name: 'n3', text: 'same' },
];

function notesLike(text: unknown, listed: unknown): readonly { readonly name: string }[] {
  return listed === undefined ? [] : NOTES.filter((note) => note.text === text).map(({ name }) => ({ name }));
}

const readFirst = {
  operation: 'latest_note',
  scope: 'playbook' as const,
  at: [],
  reads: [
    {
      field: 'saying_the_same',
      operation: 'get_note',
      description: 'Each note that says what it says',
      binds: ['name'],
      first: () => ({
        notes: { operation: 'list_notes', input: { limit: 5 } },
        never: { operation: 'a_read_the_catalog_lacks', input: {} },
      }),
      input: (item: Readonly<Record<string, unknown>>, _playbook: string, first: Readonly<Record<string, unknown>>) =>
        'never' in first ? [] : notesLike(item['text'], first['notes']),
      many: true,
    },
  ],
};

const SAME = {
  'latest_note@gamma': { name: 'n3', text: 'same' },
  'list_notes@gamma': { notes: NOTES },
  'get_note@gamma': { name: 'n1', text: 'same' },
};

function failingToList(): { readonly reads: readonly string[]; readonly reading: QueryReads } {
  const reads: string[] = [];
  const answers = new Map<string, Promise<unknown>>([['latest_note', Promise.resolve(SAME['latest_note@gamma'])]]);
  const reading = new QueryReads((read) => {
    reads.push(read.registration.name);
    return answers.get(read.registration.name) ?? Promise.reject(new Error('down'));
  });
  return { reads, reading };
}

describe('a bound read whose input needs other reads of its playbook first', () => {
  it('reads them as the query reads them itself, so its reads answer them once, and gives the input their answers', async () => {
    const { reads, reading } = asked(SAME);

    const answered = await graphql({
      schema: querySchemaOf(catalog, [readFirst]).schema,
      source: `{
        latest_note(playbook: "gamma") { saying_the_same { text } }
        list_notes(playbook: "gamma", limit: 5) { notes { name } }
      }`,
      contextValue: reading,
    });

    expect(answered.errors).toBeUndefined();
    expect(
      new Set(reads.filter(({ operation }) => operation === 'list_notes').map((read) => JSON.stringify(read))),
    ).toEqual(new Set([JSON.stringify({ operation: 'list_notes', playbook: 'gamma', input: { limit: 5 } })]));
    expect(reads.filter(({ operation }) => operation === 'get_note')).toEqual([
      { operation: 'get_note', playbook: 'gamma', input: { name: 'n1' } },
      { operation: 'get_note', playbook: 'gamma', input: { name: 'n3' } },
    ]);
  });

  it('gives the input no answer for a read that failed', async () => {
    const { reads, reading } = failingToList();

    const answered = await graphql({
      schema: querySchemaOf(catalog, [readFirst]).schema,
      source: '{ latest_note(playbook: "gamma") { saying_the_same { text } } }',
      contextValue: reading,
    });

    expect(answered).toEqual({ data: { latest_note: { saying_the_same: [] } } });
    expect(reads).toEqual(['latest_note', 'list_notes']);
  });
});
