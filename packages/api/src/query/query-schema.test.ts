import { makeCatalog } from '@on.auto/operations';
import { graphql, isNonNullType, printSchema } from 'graphql';
import { describe, expect, it } from 'vitest';

import { httpAloneOperations } from '../testing/http-alone-operations.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { querySchemaOf, QueryReads } from './query-schema.ts';

const catalog = makeCatalog([...notebookOperations, listNotesOfTheOrg, ...httpAloneOperations]);

const labelsListed = { operation: 'list_labels', at: ['labels'], key: 'playbook' };

function asked(answers: Readonly<Record<string, unknown>>) {
  const reads: { readonly operation: string; readonly playbook: string | undefined; readonly input: unknown }[] = [];
  const reading = new QueryReads((read) => {
    reads.push({ operation: read.registration.name, playbook: read.playbook, input: read.input });
    return Promise.resolve(answers[`${read.registration.name}@${String(read.playbook)}`]);
  });
  return { reads, reading };
}

describe('the query schema of a catalog', () => {
  it('has a root field for every read by GET, named as the OpenAPI document names it, and none for any other operation', () => {
    const { schema } = querySchemaOf(catalog, []);
    const fields = { ...schema.getQueryType()?.getFields() };

    expect(Object.keys(fields)).toEqual([
      'list_notes',
      'get_note',
      'latest_note',
      'break_down',
      'wait_forever',
      'list_labels',
      'list_notes_in_org',
      'read_blob',
    ]);
    expect(Object.values(fields).map((field) => [isNonNullType(field.type), field.extensions['reads']])).toEqual(
      Object.values(fields).map(() => [false, true]),
    );
    expect(schema.getMutationType()).toBeUndefined();
  });

  it('asks a playbook’s read for its playbook, and the org’s by what its input takes', () => {
    const printed = printSchema(querySchemaOf(catalog, []).schema);

    expect(printed).toContain(
      '  get_note(\n    """The playbook to read"""\n    playbook: String!\n    name: String!\n  ): GetNoteAnswer',
    );
    expect(printed).toContain('  list_notes_in_org(');
    expect(printed).toContain('  ): ListNotesInOrgAnswer');
  });
});

describe('the reads of the query schema', () => {
  it('reads each root field through the reads of the query, its playbook apart from its input and no argument given null', async () => {
    const { schema } = querySchemaOf(catalog, []);
    const { reads, reading } = asked({
      'get_note@alpha': { name: 'n1', text: 'hello' },
      'list_notes@undefined': { kept_for: 'alpha' },
    });

    const answered = await graphql({
      schema,
      source: '{ get_note(playbook: "alpha", name: "n1") { text } list_notes_in_org(playbook: null) { kept_for } }',
      contextValue: reading,
    });

    expect(answered).toEqual({ data: { get_note: { text: 'hello' }, list_notes_in_org: { kept_for: 'alpha' } } });
    expect(reads).toEqual([
      { operation: 'get_note', playbook: 'alpha', input: { name: 'n1' } },
      { operation: 'list_notes', input: {} },
    ]);
  });

  it('answers a field as an error where the query was given no reads', async () => {
    const { schema } = querySchemaOf(catalog, []);

    const answered = await graphql({ schema, source: '{ latest_note(playbook: "alpha") { name } }', contextValue: {} });

    expect([answered.data, answered.errors?.length]).toEqual([{ latest_note: null }, 1]);
  });
});

describe('the reads of each playbook an org’s read lists', () => {
  it('gives each playbook an org’s read lists every read of the playbook, asked for the playbook its key names', async () => {
    const { schema } = querySchemaOf(catalog, [labelsListed]);
    const { reads, reading } = asked({
      'list_labels@undefined': {
        labels: [
          { playbook: 'alpha', label: 'A' },
          { playbook: 'beta', label: 'B' },
        ],
      },
      'latest_note@alpha': { name: 'latest', text: 'of alpha' },
      'latest_note@beta': { name: 'latest', text: 'of beta' },
    });

    const answered = await graphql({
      schema,
      source: '{ list_labels { labels { label latest_note { text } } } }',
      contextValue: reading,
    });

    expect(answered).toEqual({
      data: {
        list_labels: {
          labels: [
            { label: 'A', latest_note: { text: 'of alpha' } },
            { label: 'B', latest_note: { text: 'of beta' } },
          ],
        },
      },
    });
    expect(reads.map(({ operation, playbook }) => [operation, playbook])).toEqual([
      ['list_labels', undefined],
      ['latest_note', 'alpha'],
      ['latest_note', 'beta'],
    ]);
    expect(printSchema(schema)).toContain('  latest_note: LatestNoteAnswer\n');
  });
});

describe('an item of an org’s read that names no playbook', () => {
  it('refuses a read for an item whose key names no playbook', async () => {
    const { schema } = querySchemaOf(catalog, [labelsListed]);
    const { reading } = asked({ 'list_labels@undefined': { labels: [{ playbook: 7, label: 'A' }] } });

    const answered = await graphql({
      schema,
      source: '{ list_labels { labels { latest_note { text } } } }',
      contextValue: reading,
    });

    expect(answered.errors).toHaveLength(1);
  });
});

describe('the version of the query schema', () => {
  it('leaves out a way to a playbook from a read the catalog does not have, and is versioned by what it prints', () => {
    const plain = querySchemaOf(catalog, []);
    const missing = querySchemaOf(catalog, [{ operation: 'list_playbooks', at: ['playbooks'], key: 'id' }]);
    const linked = querySchemaOf(catalog, [labelsListed]);

    expect(printSchema(missing.schema)).toBe(plain.text);
    expect([missing.version, linked.version === plain.version, plain.version]).toEqual([
      plain.version,
      false,
      expect.stringMatching(/^[0-9a-f]{16}$/u),
    ]);
  });
});
