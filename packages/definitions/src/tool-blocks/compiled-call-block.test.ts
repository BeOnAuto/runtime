import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { issueText } from '../document/document-issue.ts';
import { standingRenderClock } from '../testing/time/stepping-clock.ts';
import type { CallBlock } from './call-block-schemas.ts';
import { compiledCallBlock } from './compiled-call-block.ts';

const lines = new Map([
  ['/call', 4],
  ['/call/server', 5],
  ['/call/tool', 6],
  ['/call/with', 7],
  ['/call/with/channel', 8],
  ['/call/with/blocks', 9],
  ['/call/read', 12],
]);

const mebibyte = 1_048_576;

const serversAsked: string[] = [];

const reading = {
  lines,
  clock: standingRenderClock,
  mostRequestBytesTo: (server: string) => {
    serversAsked.push(server);
    return mebibyte;
  },
};

const thread: CallBlock = {
  server: 'chat',
  tool: 'thread',
  with: { channel: '{{ input.channel }}', limit: 100 },
  read: '/messages',
};

function compiledOf(call: CallBlock, inputSchema?: Schema.JsonObject) {
  return compiledCallBlock(call, reading, inputSchema);
}

function problemsOf(call: CallBlock, inputSchema?: Schema.JsonObject): readonly string[] {
  return Result.match(compiledOf(call, inputSchema), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

function withChannel(channel: Schema.Json, inputSchema?: Schema.JsonObject): readonly string[] {
  return problemsOf({ ...thread, with: { channel } }, inputSchema);
}

function timesAThousand(times: number): string {
  return `{% for i in (1..${times}) %}${'x'.repeat(1000)}{% endfor %}`;
}

const pointerWords =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

describe('a call block', () => {
  it('is taken as written, and without arguments or read', () => {
    expect([compiledOf(thread), compiledOf({ server: 'chat', tool: 'thread' })]).toEqual([
      Result.succeed(thread),
      Result.succeed({ server: 'chat', tool: 'thread' }),
    ]);
  });

  it('refuses a server or a tool of the wrong shape, each at its line', () => {
    expect(problemsOf({ ...thread, server: 'Chat', tool: 'thread replies' })).toEqual([
      expect.stringContaining('Line 5, /call/server:'),
      expect.stringContaining('Line 6, /call/tool:'),
    ]);
  });

  it.each([[''], ['messages'], ['/messages/~']])('refuses %j as read, as every pointer into an answer', (read) => {
    expect(problemsOf({ ...thread, read })).toEqual([`Line 12, /call/read: ${pointerWords}`]);
  });
});

describe('the arguments of a call block', () => {
  it('refuse a name a call does not read, a template that does not compile, and a ${', () => {
    expect([withChannel('{{ to }}'), withChannel('{{ oops'), withChannel('Bearer ${CHAT_KEY}')]).toEqual([
      [expect.stringContaining('Line 8, /call/with/channel:')],
      [expect.stringMatching(/^Line 8, \/call\/with\/channel: /u)],
      [expect.stringContaining('Line 8, /call/with/channel:')],
    ]);
  });

  it('refuse a property a closed input schema does not have, and a moment read as an object', () => {
    const closed = { type: 'object', additionalProperties: false, properties: { channel: { type: 'string' } } };

    expect([withChannel('{{ input.thread }}', closed), withChannel('{{ today.year }}')]).toEqual([
      [expect.stringContaining('Line 8, /call/with/channel:')],
      [expect.stringContaining('Line 8, /call/with/channel:')],
    ]);
  });

  it('refuse a structure among text that reads no input, and take it written | json, alone, or reading the input', () => {
    expect([
      withChannel('In {{ "a,b" | split: "," }}'),
      withChannel('In {{ "a,b" | split: "," | json }}'),
      withChannel('{{ "a,b" | split: "," }}'),
      withChannel('In {{ input }}'),
    ]).toEqual([[expect.stringContaining('Line 8, /call/with/channel:')], [], [], []]);
  });
});

describe('the values the arguments of a call block hold', () => {
  it('check every string within a list or an object at its own path', () => {
    expect(problemsOf({ ...thread, with: { blocks: [{ type: 'section', text: 'Hello {{ party }}' }, 3] } })).toEqual([
      expect.stringContaining('Line 9, /call/with/blocks/0/text:'),
    ]);
  });

  it('refuse arguments that take more than their server may be sent as JSON, or one that does alone, and leave what only an input renders to the run', () => {
    serversAsked.length = 0;

    expect([
      problemsOf({ ...thread, with: { a: timesAThousand(540), b: timesAThousand(540) } }),
      problemsOf({ ...thread, with: { channel: timesAThousand(1050) } }),
      withChannel('{{ input.channel | divided_by: 0 }}'),
    ]).toEqual([
      [expect.stringContaining('Line 7, /call/with:')],
      [expect.stringContaining('Line 8, /call/with/channel:')],
      [],
    ]);
    expect(new Set(serversAsked)).toEqual(new Set(['chat']));
  });
});
