import { probeHeader, type Probes, type RejectedProbe } from '../testing/compiled-probes.ts';

function definedOverHttp(kind: 'query' | 'command', lines: readonly string[]) {
  return [
    ...probeHeader,
    `export const probe = Operations.defineHttpOperation('playbook', '${kind}', {`,
    "  ...about, name: 'probe',",
    ...lines,
    '});',
  ];
}

const get = "  route: { method: 'GET', path: '/probe' },";

const post = "  route: { method: 'POST', path: '/probe' },";

const put = "  route: { method: 'PUT', path: '/probe' },";

const remove = "  route: { method: 'DELETE', path: '/probe' },";

const answeringJson = ['  inputSchema: Empty,', '  outputSchema: Empty,', '  reasons: [],'];

const answering = '  handle: () => Effect.succeed({}),';

const accepted: Readonly<Record<string, readonly string[]>> = {
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
  'http-command-by-put-takes-no-body.ts': definedOverHttp('command', [
    put,
    "  body: { kind: 'none' },",
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

const rejected: Readonly<Record<string, RejectedProbe>> = {
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
  'http-command-takes-a-body-of-no-kind-it-knows.ts': {
    because: 'Type \'"csv"\' is not assignable to type \'"json" | "none"\'',
    source: definedOverHttp('command', [post, "  body: { kind: 'csv' },", ...answeringJson, answering]),
  },
};

export const httpProbes: Probes = { accepted, rejected };
