import { beforeAll, describe, expect, it } from 'vitest';

import { compiledErrors, probeHeader, type RejectedProbe } from '../testing/compiled-probes.ts';

function definedOverHttp(kind: 'query' | 'command', lines: readonly string[], before: readonly string[] = []) {
  return [
    ...probeHeader,
    ...before,
    `export const probe = Operations.defineHttpOperation('playbook', '${kind}', {`,
    "  ...about, name: 'probe',",
    ...lines,
    '});',
  ];
}

const get = "  route: { method: 'GET', path: '/probe' },";

const post = "  route: { method: 'POST', path: '/probe' },";

const remove = "  route: { method: 'DELETE', path: '/probe' },";

const answeringJson = ['  inputSchema: Empty,', "  answer: { kind: 'json', outputSchema: Empty },", '  reasons: [],'];

const answeringAStream = [
  '  inputSchema: Empty,',
  "  answer: { kind: 'stream', mediaType: 'application/octet-stream' },",
  '  reasons: [],',
];

const answering = '  handle: () => Effect.succeed({}),';

const answeringTheBody = '  handle: (_input, body) => Effect.succeed(body),';

const accepted: Readonly<Record<string, readonly string[]>> = {
  'http-command-answers-the-stream-it-takes.ts': definedOverHttp('command', [
    post,
    "  body: { kind: 'octet-stream', mostBytes: 64 },",
    ...answeringAStream,
    answeringTheBody,
  ]),
  'http-query-by-get-takes-no-body.ts': definedOverHttp('query', [
    get,
    "  body: { kind: 'none' },",
    ...answeringJson,
    answering,
  ]),
  'http-query-by-post-takes-json.ts': definedOverHttp('query', [
    post,
    "  body: { kind: 'json' },",
    ...answeringJson,
    answering,
  ]),
  'http-command-by-delete-takes-no-body.ts': definedOverHttp('command', [
    remove,
    "  body: { kind: 'none' },",
    ...answeringJson,
    answering,
  ]),
};

const answerOfEitherKind = ['declare const either: Operations.JsonAnswer<typeof Empty> | Operations.StreamAnswer;'];

const rejected: Readonly<Record<string, RejectedProbe>> = {
  'http-answer-of-either-kind.ts': {
    because: "is not assignable to type 'never'",
    source: definedOverHttp(
      'query',
      [get, "  body: { kind: 'none' },", '  inputSchema: Empty,', '  answer: either,', '  reasons: [],', answering],
      answerOfEitherKind,
    ),
  },
  'http-query-by-get-takes-a-stream.ts': {
    because: 'Type \'"csv"\' is not assignable to type \'"none"\'',
    source: definedOverHttp('query', [get, "  body: { kind: 'csv', mostBytes: 64 },", ...answeringJson, answering]),
  },
  'http-query-by-get-takes-json.ts': {
    because: 'Type \'"json"\' is not assignable to type \'"none"\'',
    source: definedOverHttp('query', [get, "  body: { kind: 'json' },", ...answeringJson, answering]),
  },
  'http-query-by-post-takes-no-body.ts': {
    because: 'Type \'"none"\' is not assignable to type \'"json"\'',
    source: definedOverHttp('query', [post, "  body: { kind: 'none' },", ...answeringJson, answering]),
  },
  'http-command-by-delete-takes-json.ts': {
    because: 'Type \'"json"\' is not assignable to type \'"none"\'',
    source: definedOverHttp('command', [remove, "  body: { kind: 'json' },", ...answeringJson, answering]),
  },
  'http-streamed-body-without-most-bytes.ts': {
    because: "Property 'mostBytes' is missing",
    source: definedOverHttp('command', [post, "  body: { kind: 'csv' },", ...answeringJson, answering]),
  },
  'http-json-body-read-as-a-stream.ts': {
    because: "Type 'undefined' is not assignable to type 'StreamedBytes'",
    source: definedOverHttp('command', [post, "  body: { kind: 'json' },", ...answeringAStream, answeringTheBody]),
  },
  'http-stream-answer-answers-json.ts': {
    because: "is missing the following properties from type 'StreamedBytes': stream, bytes",
    source: definedOverHttp('query', [get, "  body: { kind: 'none' },", ...answeringAStream, answering]),
  },
  'http-json-answer-answers-a-stream.ts': {
    because: "Type 'StreamedContent' is not assignable to type '{ readonly [x: string]: never; }'",
    source: definedOverHttp('command', [
      post,
      "  body: { kind: 'octet-stream', mostBytes: 64 },",
      ...answeringJson,
      answeringTheBody,
    ]),
  },
};

describe('the compiler, given operations served over HTTP alone', () => {
  let errors: readonly string[] = [];

  beforeAll(() => {
    errors = compiledErrors('http-rules', { accepted, rejected });
  });

  it('accepts every body the method of its route may take and rejects every one it may not', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});
