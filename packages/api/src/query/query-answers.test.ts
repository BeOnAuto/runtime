import { defineQuery, makeCatalog, rejected, type Outcome, type StaleOn } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { notebookOperations } from '../testing/notebook.ts';
import { queryAnswered, queryServingOf, type ReadsAnswered } from './query-answers.ts';
import { QUERY_LIMITS } from './query-limits.ts';
import type { ReadAsked } from './query-schema.ts';

const listOrgChanges = defineQuery('org', {
  name: 'list_org_changes',
  title: 'List org changes',
  description: 'Answers what changed. It is for tests.',
  route: { method: 'GET', path: '/changes' },
  inputSchema: Schema.Struct({ since: Schema.optionalKey(Schema.String) }),
  outputSchema: Schema.Struct({ cursor: Schema.String }),
  reasons: [],
  handle: () => Effect.succeed({ cursor: 'c1' }),
});

const succeeded = (output: Readonly<Record<string, Schema.Json>>): Outcome => ({ status: 'succeeded', output });

const failed = (incident: string): Outcome => ({ status: 'failed', incident });

const labelsListed = { operation: 'list_labels', at: ['labels'], key: 'playbook' };

const withChanges = queryServingOf(makeCatalog([...notebookOperations, listOrgChanges]), [labelsListed]);

const withoutChanges = queryServingOf(makeCatalog(notebookOperations), [labelsListed]);

const listEveryChange = defineQuery('org', {
  name: 'list_org_changes',
  title: 'List org changes',
  description: 'Answers what changed across the org. It is for tests.',
  route: { method: 'GET', path: '/changes' },
  inputSchema: Schema.Struct({
    since: Schema.optionalKey(Schema.String),
    scope: Schema.optionalKey(Schema.Literals(['org', 'org_and_playbooks'])),
  }),
  outputSchema: Schema.Struct({ cursor: Schema.String }),
  reasons: [],
  handle: () => Effect.succeed({ cursor: 'c1' }),
});

const staleOn: Readonly<Record<string, readonly StaleOn[]>> = {
  list_labels: [{ kind: 'label' }],
  latest_note: [{ kind: 'note' }],
  get_note: [{ kind: 'note', keyedBy: { note: 'name' } }],
};

const declaringWhatMakesThemStale = notebookOperations.map(({ registration }) => ({
  registration: {
    ...registration,
    ...(staleOn[registration.name] === undefined ? {} : { staleOn: staleOn[registration.name] }),
  },
}));

const acrossTheOrg = queryServingOf(makeCatalog([...declaringWhatMakesThemStale, listEveryChange]), [labelsListed]);

function answeredBy(answer: (read: ReadAsked) => Outcome) {
  const batches: (readonly string[])[] = [];
  const answers: ReadsAnswered = (reads) => {
    batches.push(
      reads.map(({ registration, playbook }) => `${registration.name}${playbook === undefined ? '' : `@${playbook}`}`),
    );
    return Promise.resolve(reads.map((read) => answer(read)));
  };
  return { batches, answers };
}

const notes = ({ registration, playbook }: ReadAsked): Outcome => {
  if (registration.name === 'list_org_changes') return succeeded({ cursor: 'c1' });
  if (registration.name === 'list_labels')
    return succeeded({
      labels: [
        { playbook: 'alpha', label: 'A' },
        { playbook: 'beta', label: 'B' },
      ],
    });
  if (registration.name === 'get_note') return rejected('not_found', 'There is no such note');
  if (registration.name === 'break_down') return failed('incident-1');
  return succeeded({ name: 'latest', text: `of ${playbook ?? 'none'}` });
};

function notesWithTheCursor(cursorRead: Outcome): (read: ReadAsked) => Outcome {
  return (read) => (read.registration.name === 'list_org_changes' ? cursorRead : notes(read));
}

describe('a query answered', () => {
  it('reads the cursor first, alone, so it is taken before the reads it covers, then level by level, each read once', async () => {
    const { batches, answers } = answeredBy(notes);

    const answered = await queryAnswered(
      withChanges,
      {
        query: `{
          list_labels { labels { label latest_note { text } again: latest_note { text } } }
          latest_note(playbook: "gamma") { text }
        }`,
      },
      answers,
    );

    expect(answered).toEqual({
      status: 200,
      body: {
        data: {
          list_labels: {
            labels: [
              { label: 'A', latest_note: { text: 'of alpha' }, again: { text: 'of alpha' } },
              { label: 'B', latest_note: { text: 'of beta' }, again: { text: 'of beta' } },
            ],
          },
          latest_note: { text: 'of gamma' },
        },
        extensions: { schema_version: withChanges.schema.version, cursor: 'c1', read: [] },
      },
    });
    expect(batches).toEqual([
      ['list_org_changes'],
      ['list_labels', 'latest_note@gamma'],
      ['latest_note@alpha', 'latest_note@beta'],
    ]);
  });
});

const theNoteOfEachListed = {
  operation: 'list_notes',
  scope: 'playbook' as const,
  at: ['notes'],
  reads: [
    {
      field: 'the_note',
      operation: 'get_note',
      description: 'The note read whole',
      binds: ['name'],
      input: (item: Readonly<Record<string, unknown>>) => ({ name: item['name'] }),
    },
  ],
};

const withBoundReads = queryServingOf(makeCatalog([...notebookOperations, listOrgChanges]), [
  labelsListed,
  theNoteOfEachListed,
]);

const twoNotes = succeeded({ notes: ['n1', 'n2'].map((name) => ({ name, text: '' })) });

const noteOf = ({ input, playbook }: ReadAsked) =>
  succeeded({ name: String(input['name']), text: `${String(input['name'])} of ${String(playbook)}` });

const listedNotes = (read: ReadAsked): Outcome =>
  ({ list_notes: twoNotes, get_note: noteOf(read) })[read.registration.name] ?? notes(read);

const notesOf = (playbook: string) => ({
  list_notes: { notes: ['n1', 'n2'].map((name) => ({ the_note: { text: `${name} of ${playbook}` } })) },
});

describe('a query whose reads depend on what others answered', () => {
  it('reads each level once every read of the level above is answered, all of a level together, so a nest of three levels is three batches', async () => {
    const { batches, answers } = answeredBy(listedNotes);

    const { body } = await queryAnswered(
      withBoundReads,
      { query: '{ list_labels { labels { list_notes(limit: 2) { notes { the_note { text } } } } } }' },
      answers,
    );

    expect(body['data']).toEqual({ list_labels: { labels: [notesOf('alpha'), notesOf('beta')] } });
    expect(batches).toEqual([
      ['list_org_changes'],
      ['list_labels'],
      ['list_notes@alpha', 'list_notes@beta'],
      ['get_note@alpha', 'get_note@alpha', 'get_note@beta', 'get_note@beta'],
    ]);
  });
});

describe('a query answered with what it read', () => {
  it('carries each kind of change that makes a read of it stale, with the playbook and keys it read, once, and the cursor of the org and its playbooks', async () => {
    const inputs: (readonly [string, unknown])[] = [];
    const { answers } = answeredBy((read) => {
      inputs.push([read.registration.name, read.input]);
      return notes(read);
    });

    const { body } = await queryAnswered(
      acrossTheOrg,
      {
        query: `{
          list_labels { labels { latest_note { text } } }
          latest_note(playbook: "alpha") { text }
          get_note(playbook: "beta", name: "n1") { text }
        }`,
      },
      answers,
    );

    expect(body['extensions']).toEqual({
      schema_version: acrossTheOrg.schema.version,
      cursor: 'c1',
      read: [
        { kind: 'label' },
        { kind: 'note', playbook: 'alpha' },
        { kind: 'note', playbook: 'beta', key: { note: 'n1' } },
        { kind: 'note', playbook: 'beta' },
      ],
    });
    expect(inputs.filter(([name]) => name === 'list_org_changes')).toEqual([
      ['list_org_changes', { scope: 'org_and_playbooks' }],
    ]);
  });
});

describe('a query whose reads are refused', () => {
  it('answers a read refused or failed as an error of its field, with its reason, and the rest as read', async () => {
    const { answers } = answeredBy(notes);

    const { status, body } = await queryAnswered(
      withoutChanges,
      {
        query:
          'query Notes($name: String!) { get_note(playbook: "alpha", name: $name) { text } break_down(playbook: "alpha") latest_note(playbook: "alpha") { text } }',
        variables: { name: 'n1' },
        operationName: 'Notes',
      },
      answers,
    );

    expect([status, body['data'], body['extensions']]).toEqual([
      200,
      { get_note: null, break_down: null, latest_note: { text: 'of alpha' } },
      { schema_version: withoutChanges.schema.version, cursor: null, read: [] },
    ]);
    expect(JSON.parse(JSON.stringify(body['errors']))).toEqual([
      expect.objectContaining({ path: ['get_note'], extensions: { code: 'not_found' } }),
      expect.objectContaining({ path: ['break_down'], extensions: { code: 'failed', incident: 'incident-1' } }),
    ]);
  });

  it.each([
    ['is refused', rejected('forbidden', 'No')],
    ['answers none', succeeded({})],
  ])('answers no cursor where the read of the cursor %s', async (_, cursorRead) => {
    const { answers } = answeredBy(notesWithTheCursor(cursorRead));

    const { body } = await queryAnswered(withChanges, { query: '{ latest_note(playbook: "a") { text } }' }, answers);

    expect(body['extensions']).toEqual({ schema_version: withChanges.schema.version, cursor: null, read: [] });
  });
});

const failingTheCursor: ReadsAnswered = (reads) =>
  reads.some(({ registration }) => registration.name === 'list_org_changes')
    ? Promise.reject(new Error('The cursor could not be read'))
    : Promise.resolve(reads.map((read) => notes(read)));

describe('a query whose cursor fails', () => {
  it('answers its reads and no cursor where the read of the cursor fails outright', async () => {
    const { body } = await queryAnswered(
      withChanges,
      { query: '{ latest_note(playbook: "a") { text } }' },
      failingTheCursor,
    );

    expect([body['data'], body['extensions']]).toEqual([
      { latest_note: { text: 'of a' } },
      { schema_version: withChanges.schema.version, cursor: null, read: [] },
    ]);
  });
});

describe('a query refused', () => {
  it.each([
    ['a document that does not parse', '{ latest_note(', undefined],
    ['a field the schema lacks', '{ list_everything }', undefined],
    ['a variable of the wrong type', 'query ($p: String!) { latest_note(playbook: $p) { text } }', { p: 7 }],
    ['a query past a limit', '{ a: list_labels { __typename } b: list_labels { __typename } }', undefined],
  ] as const)('refuses %s before it reads anything, as a request error', async (_, query, variables) => {
    const { batches, answers } = answeredBy(notes);

    const { status, body } = await queryAnswered(
      { ...withChanges, limits: { ...QUERY_LIMITS, aliases: 1 } },
      { query, variables },
      answers,
    );

    expect([status, body['data'], body['extensions'], batches.length]).toEqual([
      400,
      undefined,
      { schema_version: withChanges.schema.version },
      0,
    ]);
    expect(body['errors']).toHaveLength(1);
  });
});
