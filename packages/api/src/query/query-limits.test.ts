import { makeCatalog } from '@on.auto/operations';
import { buildSchema, parse, type GraphQLError } from 'graphql';
import { describe, expect, it } from 'vitest';

import { notebookOperations } from '../testing/notebook.ts';
import { limitsBrokenBy, QUERY_LIMITS, type QueryLimits } from './query-limits.ts';
import { querySchemaOf } from './query-schema.ts';

const { schema } = querySchemaOf(makeCatalog(notebookOperations), [
  { operation: 'list_labels', at: ['labels'], key: 'playbook' },
  {
    operation: 'list_notes',
    scope: 'playbook',
    at: ['notes'],
    reads: [
      {
        field: 'the_note',
        operation: 'get_note',
        description: 'The note read whole',
        binds: ['name'],
        input: (item) => ({ name: item['name'] }),
      },
    ],
  },
]);

const loose: QueryLimits = { depth: 10, aliases: 10, rootFields: 10, cost: 100, listSize: 3 };

function codesOf(errors: readonly GraphQLError[]): readonly unknown[] {
  return errors.map((error) => error.extensions['code']);
}

function broken(source: string, limits: Partial<QueryLimits>, operationName?: string): readonly unknown[] {
  return codesOf(limitsBrokenBy(schema, parse(source), operationName, { ...loose, ...limits }));
}

const labelled = '{ list_labels { labels { label latest_note { name } } } }';

const twoAliases = `{
  a: latest_note(playbook: "alpha") { n: name }
  b: latest_note(playbook: "beta") { name }
  list_labels { __typename }
}`;

describe('the limits of a query, checked before it runs', () => {
  it.each([
    ['as deep as its depth', labelled, { depth: 4 }, []],
    ['deeper than its depth', labelled, { depth: 3 }, ['query_too_deep']],
    ['with as many aliased reads as it may have', twoAliases, { aliases: 2 }, []],
    ['with more aliased reads than it may have', twoAliases, { aliases: 1 }, ['too_many_aliases']],
    ['with as many root fields as it may have', twoAliases, { rootFields: 3 }, []],
    ['with more root fields than it may have', twoAliases, { rootFields: 2 }, ['too_many_root_fields']],
    ['costing what it may, a read below a list counted once for each item a list may hold', labelled, { cost: 4 }, []],
    ['costing more than it may', labelled, { cost: 3 }, ['query_too_costly']],
    [
      'breaking every limit',
      twoAliases,
      { depth: 1, aliases: 0, rootFields: 0, cost: 0 },
      ['query_too_deep', 'too_many_aliases', 'too_many_root_fields', 'query_too_costly'],
    ],
  ] as const)('passes or refuses a query %s', (_, source, limits, codes) => {
    expect(broken(source, limits)).toEqual(codes);
  });
});

describe('the cost of the reads bound to what a read answers', () => {
  it.each([
    ['a list as long as a list may be', '{ list_notes(playbook: "a") { notes { the_note { name } } } }', 4],
    ['a list as long as its limit', '{ list_notes(playbook: "a", limit: 2) { notes { the_note { name } } } }', 3],
    ['a limit past a list’s length', '{ list_notes(playbook: "a", limit: 9) { notes { the_note { name } } } }', 4],
    [
      'reads nested under reads, each level multiplied',
      '{ list_labels { labels { list_notes(limit: 2) { notes { the_note { name } } } } } }',
      1 + 3 + 3 * 2,
    ],
  ] as const)('counts each bound read once for each item of %s', (_, source, cost) => {
    expect([broken(source, { cost }), broken(source, { cost: cost - 1 })]).toEqual([[], ['query_too_costly']]);
  });

  it('counts a list as long as a list may be where its limit is a variable', () => {
    const source = 'query ($n: Int) { list_notes(playbook: "a", limit: $n) { notes { the_note { name } } } }';

    expect(broken(source, { cost: 3 })).toEqual(['query_too_costly']);
  });
});

describe('the limits of a query with fragments and several operations', () => {
  it('counts the fields of fragments, named and inline, where they are spread', () => {
    const source = `
      query Labelled { ...Root }
      fragment Root on Query { list_labels { labels { ... on ListLabelsAnswerLabels { latest_note { name } } } } }
    `;

    expect(broken(source, { cost: 3 }, 'Labelled')).toEqual(['query_too_costly']);
    expect(broken(source, { depth: 3 }, 'Labelled')).toEqual(['query_too_deep']);
  });

  it('checks the operation named, and nothing where the document holds no such operation', () => {
    const source = `query Small { list_labels { __typename } } query Large ${labelled}`;

    expect([broken(source, { cost: 3 }, 'Small'), broken(source, { cost: 3 }, 'Large')]).toEqual([
      [],
      ['query_too_costly'],
    ]);
    expect(broken(source, { cost: 0 }, 'Missing')).toEqual([]);
  });

  it('measures a union’s members and an untyped fragment, and nothing for a fragment the document lacks', () => {
    const shaped = buildSchema('type Query { a: U } union U = B type B { x: String }');
    const measure = (source: string) =>
      codesOf(limitsBrokenBy(shaped, parse(source), undefined, { ...loose, depth: 2 }));

    expect(measure('{ a { __typename ... on B { x } } }')).toEqual([]);
    expect(measure('{ ... { a { ... on B { ... { x { y } } } } } }')).toEqual(['query_too_deep']);
    expect(measure('{ ...Missing }')).toEqual([]);
  });

  it('ships with these limits', () => {
    expect(QUERY_LIMITS).toEqual({ depth: 16, aliases: 30, rootFields: 30, cost: 50000, listSize: 100 });
  });
});
