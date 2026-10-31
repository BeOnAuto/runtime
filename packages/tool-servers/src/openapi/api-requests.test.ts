import { Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { apiRequestOf, isUnderBase, type ApiEndpoint } from './api-requests.ts';
import type { ApiOperation } from './api-tools.ts';

const endpoint: ApiEndpoint = {
  baseUrl: 'https://graph.example.com/v1',
  headers: new Map([['X-Api-Key', Redacted.make('graph-api-key-4f1d9a7c2b')]]),
  query: new Map([['tenant', Redacted.make('acme')]]),
};

const tool = { name: 'notes', inputSchema: {} };

const listing: ApiOperation = {
  tool,
  method: 'get',
  path: '/notes/{folder}/{id}',
  inputs: [
    { name: 'folder', in: 'path' },
    { name: 'id', in: 'path' },
    { name: 'tag', in: 'query', joinsLists: false },
    { name: 'limit', in: 'query', joinsLists: false },
  ],
  body: null,
  credentials: [],
  answers: { schemas: [], components: {}, headers: {}, describesNoBody: false },
};

const writing: ApiOperation = {
  tool,
  method: 'post',
  path: '/notes',
  inputs: [],
  body: { mediaType: 'application/merge-patch+json', required: true },
  credentials: [],
  answers: { schemas: [], components: {}, headers: {}, describesNoBody: false },
};

const pair: ApiOperation = {
  tool,
  method: 'get',
  path: '/notes/{a}{b}',
  inputs: [
    { name: 'a', in: 'path' },
    { name: 'b', in: 'path' },
  ],
  body: null,
  credentials: [],
  answers: { schemas: [], components: {}, headers: {}, describesNoBody: false },
};

const climbedOut = 'The path arguments would take the call out of the path of this operation, as a . or a .. does';

function refusalOf(operation: ApiOperation, input: Readonly<Record<string, unknown>>): string {
  return Result.getOrThrow(Result.flip(apiRequestOf(operation, input, endpoint)));
}

describe('the path of a call of an HTTP API', () => {
  it('refuses an argument that reads as . or .. once encoded, alone or joined in one segment, which would climb out of the operation', () => {
    expect([
      refusalOf(listing, { folder: '..', id: 'b' }),
      refusalOf(listing, { folder: 'a', id: '.' }),
      refusalOf(listing, { folder: ['..'], id: 'b' }),
      refusalOf(pair, { a: '.', b: '.' }),
    ]).toEqual([climbedOut, climbedOut, climbedOut, climbedOut]);
  });

  it('keeps a dot that is not a whole segment, and a character an address reserves, inside its segment', () => {
    expect(Result.map(apiRequestOf(listing, { folder: 'a?b#c', id: '...' }, endpoint), ({ url }) => url)).toEqual(
      Result.succeed('https://graph.example.com/v1/notes/a%3Fb%23c/...?tenant=acme'),
    );
  });

  it('refuses an empty argument, or a list that holds one, unsent', () => {
    const empty = 'The argument folder is empty, which a path argument may not be';

    expect([refusalOf(listing, { folder: '', id: 'b' }), refusalOf(listing, { folder: ['a', ''], id: 'b' })]).toEqual([
      empty,
      empty,
    ]);
  });
});

describe('the path of a call of an HTTP API whose argument holds a /', () => {
  it('sends the / encoded inside the one segment of the argument, which leaves the path of the operation as it is', () => {
    const given = ['https://www.example.com/', '../../admin', 'a/../b', '..\\..\\admin', '/'];
    const sent = given.map((folder) =>
      Result.getOrThrow(Result.map(apiRequestOf(listing, { folder, id: 'b' }, endpoint), ({ url }) => url)),
    );
    const paths = sent.map((url) => new URL(url).pathname);

    expect(paths).toEqual([
      '/v1/notes/https%3A%2F%2Fwww.example.com%2F/b',
      '/v1/notes/..%2F..%2Fadmin/b',
      '/v1/notes/a%2F..%2Fb/b',
      '/v1/notes/..%5C..%5Cadmin/b',
      '/v1/notes/%2F/b',
    ]);
    expect(paths.map((path) => path.split('/').map((segment) => decodeURIComponent(segment)))).toEqual(
      given.map((folder) => ['', 'v1', 'notes', folder, 'b']),
    );
    expect(sent.every((url) => isUnderBase(endpoint.baseUrl, url))).toBe(true);
  });

  it('joins a list whose items hold a /, each item encoded and the commas between them not', () => {
    expect(Result.map(apiRequestOf(listing, { folder: ['a', 'b/c'], id: 'd' }, endpoint), ({ url }) => url)).toEqual(
      Result.succeed('https://graph.example.com/v1/notes/a,b%2Fc/d?tenant=acme'),
    );
  });
});

describe('the address of a call of an HTTP API', () => {
  it('is under base_url when it has its origin and its path begins with the path of base_url', () => {
    expect([
      isUnderBase('https://graph.example.com/v1', 'https://graph.example.com/v1/notes?x=1'),
      isUnderBase('https://graph.example.com/v1', 'https://graph.example.com/v1'),
      isUnderBase('https://graph.example.com', 'https://graph.example.com/notes'),
      isUnderBase('https://graph.example.com/v1', 'https://graph.example.com.attacker.example/notes'),
      isUnderBase('https://graph.example.com', 'https://graph.example.com:8443/notes'),
      isUnderBase('https://graph.example.com/v1', 'https://graph.example.com/v1evil/notes'),
      isUnderBase('https://graph.example.com/v1', 'https://graph.example.com/v1/../admin'),
      isUnderBase('https://graph.example.com/v1', 'not an address'),
      isUnderBase('data:text/plain,a', 'data:text/plain,a/b'),
    ]).toEqual([true, true, true, false, false, false, false, false, false]);
  });
});

describe('the request of a call of an HTTP API', () => {
  it('fills the path with its encoded arguments and the query with repeated keys and the parameters of the entry, asking for JSON first and taking any answer', () => {
    expect(apiRequestOf(listing, { folder: 'a b', id: 7, tag: ['x', true], limit: null }, endpoint)).toEqual(
      Result.succeed({
        url: 'https://graph.example.com/v1/notes/a%20b/7?tag=x&tag=true&tenant=acme',
        method: 'GET',
        headers: { 'X-Api-Key': 'graph-api-key-4f1d9a7c2b', accept: 'application/json, */*;q=0.5' },
        body: null,
        usesToken: false,
        named: undefined,
      }),
    );
  });

  it('joins a list given for a path parameter, and leaves out a query with nothing in it', () => {
    const bare = { ...endpoint, query: new Map() };

    expect(Result.map(apiRequestOf(listing, { folder: ['a', 'b'], id: 'c' }, bare), ({ url }) => url)).toEqual(
      Result.succeed('https://graph.example.com/v1/notes/a,b/c'),
    );
  });
});

describe('the file a call of an HTTP API names', () => {
  it('is the argument of a path parameter its operation names a file name, and no other', () => {
    const fetching: ApiOperation = {
      ...listing,
      path: '/folders/{folder}/files/{file_name}',
      inputs: [
        { name: 'folder', in: 'path' },
        { name: 'file_name', in: 'path' },
      ],
    };
    const namesOf = (input: Readonly<Record<string, unknown>>) =>
      Result.map(apiRequestOf(fetching, input, endpoint), ({ named }) => ({ named }));

    expect([
      namesOf({ folder: 'terms', file_name: 'Supplier terms.pdf' }),
      namesOf({ folder: 'terms', file_name: 7 }),
      Result.map(apiRequestOf(listing, { folder: 'a', id: 'terms.pdf' }, endpoint), ({ named }) => ({ named })),
    ]).toEqual([
      Result.succeed({ named: 'Supplier terms.pdf' }),
      Result.succeed({ named: undefined }),
      Result.succeed({ named: undefined }),
    ]);
  });
});

describe('the body of a call of an HTTP API', () => {
  it('is sent as JSON in the media type of the operation', () => {
    expect(apiRequestOf(writing, { body: { text: 'Hello' } }, endpoint)).toEqual(
      Result.succeed({
        url: 'https://graph.example.com/v1/notes?tenant=acme',
        method: 'POST',
        headers: {
          'X-Api-Key': 'graph-api-key-4f1d9a7c2b',
          accept: 'application/json, */*;q=0.5',
          'content-type': 'application/merge-patch+json',
        },
        body: '{"text":"Hello"}',
        usesToken: false,
        named: undefined,
      }),
    );
    expect(
      Result.map(
        apiRequestOf({ ...writing, body: { mediaType: 'application/json', required: false } }, {}, endpoint),
        ({ body }) => body,
      ),
    ).toEqual(Result.succeed(null));
  });
});

describe('the query of a call of an HTTP API', () => {
  it('joins by commas a list of a query parameter written with explode false, each item encoded and the commas not', () => {
    const joined: ApiOperation = {
      ...listing,
      path: '/notes',
      inputs: [
        { name: 'label', in: 'query', joinsLists: true },
        { name: 'state', in: 'query', joinsLists: true },
        { name: 'none', in: 'query', joinsLists: true },
        { name: 'tag', in: 'query', joinsLists: false },
      ],
    };

    expect(
      Result.map(
        apiRequestOf(joined, { label: ['red', 'a,b', 'x y'], state: 'open', none: [], tag: ['p', 'q'] }, endpoint),
        ({ url }) => url,
      ),
    ).toEqual(
      Result.succeed('https://graph.example.com/v1/notes?label=red,a%2Cb,x+y&state=open&tag=p&tag=q&tenant=acme'),
    );
  });
});

describe('the arguments a call of an HTTP API cannot send', () => {
  it('refuses arguments the operation does not take, a path it cannot fill, an object outside the body, or a missing body', () => {
    const refusals = [
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: 'a', id: 'b', color: 'red' }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: 'a' }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: { name: 'a' }, id: 'b' }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: 'a', id: 'b', tag: [{ name: 'x' }] }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(writing, {}, endpoint))),
    ];

    expect(refusals).toEqual([
      'The arguments give color, which this operation does not take',
      'The arguments give no id, which the path of this operation needs',
      'The argument folder is an object, which a call does not send in a path or a query',
      'The argument tag is an object, which a call does not send in a path or a query',
      'The arguments give no body, which this operation needs',
    ]);
  });
});
