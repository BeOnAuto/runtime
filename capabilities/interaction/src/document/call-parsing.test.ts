import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { summarize } from '../capability/definition-reading.ts';
import { callDocument, replyRuleLines } from '../testing/index.ts';
import { problemsOf, reading } from '../testing/route-documents.ts';
import { parseInteractionDocument } from './document-parsing.ts';

const pointerWords =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

const asksNoParty = 'A function with call answers at once and asks no party, so it takes no';

describe('an interaction function that asks a system', () => {
  it('reads its call as written, and is summarised with the tool it calls', () => {
    const parsed = Result.getOrThrow(parseInteractionDocument(callDocument(), standingRenderClock));

    expect(parsed).toMatchObject({
      shape: 'call',
      call: {
        server: 'chat',
        tool: 'thread',
        with: { channel: '{{ input.channel }}', ts: '{{ input.thread }}', limit: 100, inclusive: false },
        read: '/messages',
      },
      output: { schema: { document: { type: 'array' } } },
    });
    expect(summarize(parsed)).toMatchObject({
      description: 'Read the replies of a thread in the team chat, oldest first',
      details: { call: { server: 'chat', tool: 'thread' } },
    });
  });

  it('takes a call without arguments and without read, which answers with the whole answer', () => {
    expect(problemsOf(callDocument({ with: [], read: null }))).toEqual([]);
  });
});

describe('the keys a function that asks a system takes', () => {
  it('takes a call without a description or an input schema, and refuses an input schema it cannot compile', () => {
    const plain = ['---', 'call:', '  server: chat', '  tool: thread', 'output:', '  schema: {}', '---', ''].join('\n');

    expect(problemsOf(plain)).toEqual([]);
    expect(problemsOf(callDocument({ input: ['input:', '  schema: { type: thing }'] }))).toEqual([
      expect.stringMatching(/^Line 13, \/input\/schema/u),
    ]);
  });

  it('refuses a key of call it does not hold, with its line', () => {
    expect(problemsOf(callDocument({ with: ['    channel: C0123'], front: ['  limit: 3'] }))).toEqual([
      'Line 9, /call/limit: limit is not a key of call; it takes server, tool, with, read',
    ]);
  });

  it.each([
    ["to: '{{ input.channel }}'", 'to'],
    ['expires: P2D', 'expires'],
    ['from: ada', 'from'],
    ['deliver: { server: chat, tool: post_message, with: {} }', 'deliver'],
  ])('refuses %s beside call, at its line', (line, key) => {
    expect(problemsOf(callDocument({ front: [line] }))).toContainEqual(`Line 12, /${key}: ${asksNoParty} ${key}`);
  });

  it('refuses replies and a reply rule beside call, at their lines', () => {
    const problems = problemsOf(callDocument({ front: [...reading, ...replyRuleLines] }));

    expect(problems).toContainEqual(`Line 13, /replies: ${asksNoParty} replies`);
    expect(problems.filter((problem) => problem.endsWith(`${asksNoParty} reply`))).toHaveLength(1);
  });

  it('refuses a body beside call at its first written line, and never reads it as a message', () => {
    expect(problemsOf(callDocument({ body: '\n\nHello {{ oops' }))).toEqual([
      'Line 33: A function with call sends no message: leave the body after the front matter empty, and say what the function does in description',
    ]);
  });

  it('refuses a call without an output schema, at its line', () => {
    expect(problemsOf(callDocument({ output: [] }))).toEqual([
      'Line 4, /call: A function with call answers with what the tool answered, so output.schema says what that is',
    ]);
  });
});

describe('the names and the pointer of a call', () => {
  it('refuse a server or a tool of the wrong shape', () => {
    expect(problemsOf(callDocument({ server: 'Chat', tool: 'thread replies' }))).toEqual([
      'Line 4, /call/server: Expected a server name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      'Line 5, /call/tool: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
    ]);
  });

  it.each([["''"], ['messages'], ['/messages/~']])('refuse %s as read, as every pointer of the format', (read) => {
    expect(problemsOf(callDocument({ read }))).toEqual([`Line 11, /call/read: ${pointerWords}`]);
  });
});

describe('the arguments of a call', () => {
  it('refuse a template that reads a name the call does not have, or a property the input schema does not allow', () => {
    const closed = [
      'input:',
      '  schema: { type: object, additionalProperties: false, properties: { channel: { type: string } } }',
    ];

    expect([
      problemsOf(callDocument({ with: ["    channel: '{{ to }}'"] })),
      problemsOf(callDocument({ with: ["    channel: '{{ input.thread }}'"], input: closed })),
    ]).toEqual([
      ['Line 7, /call/with/channel: Reads to, which a template of a call does not have; it reads input, today and now'],
      ['Line 7, /call/with/channel: input.thread is not a property of the input schema, which allows no others'],
    ]);
  });

  it('refuse a secret, and a text that renders a structure among text without reading the input', () => {
    expect([
      problemsOf(callDocument({ with: ["    channel: '${CHAT_KEY}'"] })),
      problemsOf(callDocument({ with: ['    channel: \'In {{ "a,b" | split: "," }}\''] })),
    ]).toEqual([
      ['Line 7, /call/with/channel: Expected no ${ in a template, which never holds a secret'],
      [
        'Line 7, /call/with/channel: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      ],
    ]);
  });

  it('refuse arguments that read no input and take more than 16 KiB as JSON, or one that does alone', () => {
    const half = 'x'.repeat(8200);

    expect([
      problemsOf(callDocument({ with: [`    a: ${half}`, `    b: ${half}`] })),
      problemsOf(callDocument({ with: [`    note: ${half}${half}`] })),
    ]).toEqual([
      ['Line 7, /call/with: The arguments of the call take 16415 bytes, more than the 16384 a call may send'],
      ['Line 7, /call/with/note: The argument note of the call renders more than the 16384 bytes a call may send'],
    ]);
  });
});
