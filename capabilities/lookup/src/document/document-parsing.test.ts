import { issueText } from '@on.auto/definitions/document';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookupDocument } from '../testing/index.ts';
import { parseLookupDocument } from './document-parsing.ts';

const anOpenSchema: unknown = expect.objectContaining({ document: {} });

function problemsOf(source: string): readonly string[] {
  return Result.match(parseLookupDocument(source, standingRenderClock), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('a lookup function document', () => {
  it('reads its call, the line it starts on and its schemas as written', () => {
    const parsed = Result.getOrThrow(parseLookupDocument(lookupDocument(), standingRenderClock));

    expect(parsed).toMatchObject({
      description: 'Read the replies of a thread in the team chat, oldest first',
      call: {
        server: 'chat',
        tool: 'thread',
        with: { channel: '{{ input.channel }}', ts: '{{ input.thread }}', limit: 100, inclusive: false },
        read: '/messages',
      },
      callLine: 4,
      input: { schema: { document: { type: 'object' } } },
      output: { schema: { document: { type: 'array' } } },
    });
  });

  it('takes a call without arguments, read, a description or an input schema', () => {
    const plain = ['---', 'call:', '  server: chat', '  tool: thread', 'output:', '  schema: {}', '---', ''].join('\n');

    expect([problemsOf(plain), problemsOf(lookupDocument({ with: [], read: null }))]).toEqual([[], []]);
    expect(Result.getOrThrow(parseLookupDocument(plain, standingRenderClock))).toEqual({
      call: { server: 'chat', tool: 'thread' },
      callLine: 3,
      input: {},
      output: { schema: anOpenSchema },
    });
  });
});

describe('the keys a lookup function document refuses', () => {
  it('refuses a document without call, or with empty front matter', () => {
    const uncalled = ['---', 'output:', '  schema: {}', '---', ''].join('\n');

    expect([problemsOf(uncalled), problemsOf('---\n---\n')]).toEqual([
      ['Line 1, /call: call is required'],
      ['Line 2: The front matter is empty; it names at least the tool it reads through'],
    ]);
  });

  it.each([
    ["to: '{{ input.owner }}'", 'to'],
    ['expires: P2D', 'expires'],
    ['deliver: agent', 'deliver'],
    ['model: claude', 'model'],
  ])('refuses %s, a key no lookup function takes, at its line', (line, key) => {
    expect(problemsOf(lookupDocument({ front: [line] }))).toEqual([
      expect.toSatisfy((problem: string) => problem.startsWith(`Line 12, /${key}: ${key} is not a key`)),
    ]);
  });

  it('refuses a key of call it does not hold, and a lookup without an output schema, at the call', () => {
    expect([
      problemsOf(lookupDocument({ with: ['    channel: C0123'], front: ['  limit: 3'] })),
      problemsOf(lookupDocument({ output: [] })),
    ]).toEqual([
      ['Line 9, /call/limit: limit is not a key of call; it takes server, tool, with, read'],
      ['Line 4, /call: A lookup function answers with what its tool answered, so output.schema says what that is'],
    ]);
  });
});

describe('the parts of a lookup function document it refuses', () => {
  it('refuses a body at its first written line, beside a refused front matter too', () => {
    const noBody =
      'Line 33: A lookup function sends no message and asks no model: leave the body after the front matter empty, and say what the function does in description';

    expect([
      problemsOf(lookupDocument({ body: '\n\nRead {{ input.channel }}' })),
      problemsOf(lookupDocument({ front: ['expires: P2D'], body: '\n\nRead it' })),
      problemsOf(['---', 'call: [', '---', 'Read it'].join('\n')),
    ]).toEqual([
      [noBody],
      [
        expect.stringContaining('/expires: expires is not a key'),
        expect.stringContaining('A lookup function sends no message'),
      ],
      [expect.stringMatching(/^Line 2/u), expect.stringContaining('A lookup function sends no message')],
    ]);
  });

  it('refuses an input or an output schema it cannot compile, at its line', () => {
    expect([
      problemsOf(lookupDocument({ input: ['input:', '  schema: { type: thing }'] })),
      problemsOf(lookupDocument({ output: ['output:', '  schema: { type: thing }'] })),
    ]).toEqual([
      [expect.stringMatching(/^Line 13, \/input\/schema/u)],
      [expect.stringMatching(/^Line 20, \/output\/schema/u)],
    ]);
  });

  it('refuses a call its block refuses, its names, its pointer and its arguments', () => {
    expect([
      problemsOf(lookupDocument({ server: 'Chat' })),
      problemsOf(lookupDocument({ read: 'messages' })),
      problemsOf(lookupDocument({ with: ["    channel: '{{ to }}'"] })),
    ]).toEqual([
      [expect.stringMatching(/^Line 4, \/call\/server: Expected a server name/u)],
      [expect.stringMatching(/^Line 11, \/call\/read: Expected a JSON Pointer/u)],
      ['Line 7, /call/with/channel: Reads to, which a template of a call does not have; it reads input, today and now'],
    ]);
  });
});
