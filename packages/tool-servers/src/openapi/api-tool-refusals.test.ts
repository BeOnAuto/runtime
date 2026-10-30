import { describe, expect, it } from 'vitest';

import { documentOf, problemsOf, unfollowedReference } from '../api-testing/derived-documents.ts';

const missing = 'A reference to a component the document does not have';

describe('a document whose operations would not be tools of their own', () => {
  it('is refused for two operations that would share a tool name, naming both', () => {
    expect(
      problemsOf(documentOf({ '/a': { get: { operationId: 'notes' } }, '/b': { get: { operationId: 'notes' } } })),
    ).toEqual([
      {
        pointer: '/paths/~1b/get',
        detail:
          'The tool name notes is the name of the operation at /paths/~1a/get too; give one of them another operationId',
      },
    ]);
  });

  it('is refused for more operations than a tool server may offer', () => {
    const paths = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`/n${index}`, { get: {} }]));

    expect(problemsOf(documentOf(paths))).toEqual([
      { pointer: '/paths', detail: 'The document holds 501 operations, more than the 500 a tool server may offer' },
    ]);
  });
});

describe('a document whose references cannot be followed', () => {
  it('is refused for a parameter or a body it does not have, a reference elsewhere, or a chain too long', () => {
    const loop = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`P${index}`, { $ref: `#/components/parameters/P${index + 1}` }]),
    );
    const paths = {
      '/a': { get: { parameters: [{ $ref: '#/components/parameters/Nowhere' }] } },
      '/b': { post: { requestBody: { $ref: 'other.yaml#/components/requestBodies/Note' } } },
      '/c': { get: { parameters: [{ $ref: '#/components/parameters/P0' }] } },
      '/d': { post: { requestBody: { content: { 'application/json': { schema: { $ref: 'other.yaml#/Note' } } } } } },
    };

    expect(problemsOf(documentOf(paths, { components: { parameters: loop } }))).toEqual([
      { pointer: '/paths/~1a/get/parameters/0/$ref', detail: missing },
      { pointer: '/paths/~1b/post/requestBody/$ref', detail: missing },
      { pointer: '/paths/~1c/get/parameters/0', detail: 'A reference that leads through more than 8 others' },
      { pointer: '/paths/~1d/post/requestBody/content/application~1json/schema/$ref', detail: unfollowedReference },
    ]);
  });

  it('is refused for a schema it does not have, or one that refers outside the document, at its place', () => {
    const outside = { name: 'f', in: 'query', schema: { $ref: 'filters.yaml#/Filter' } };
    const absent = { name: 'f', in: 'query', schema: { $ref: '#/components/schemas/Missing' } };

    expect(problemsOf(documentOf({ '/a': { get: { parameters: [outside] } } }))).toEqual([
      { pointer: '/paths/~1a/get/parameters/0/schema/$ref', detail: unfollowedReference },
    ]);
    expect(problemsOf(documentOf({ '/d': { get: { parameters: [absent] } } }))).toEqual([
      {
        pointer: '/paths/~1d/get/parameters/0/schema/$ref',
        detail: 'A reference to a schema the document does not have under components',
      },
    ]);
  });

  it('is refused for a component schema with a reference it cannot follow', () => {
    expect(problemsOf(documentOf({}, { components: { schemas: { Note: { $ref: '#/$defs/Note' } } } }))).toEqual([
      { pointer: '/components/schemas/Note/$ref', detail: unfollowedReference },
    ]);
  });
});
