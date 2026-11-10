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

const reading = { lines, clock: standingRenderClock };

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
      'Line 5, /call/server: Expected a server name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      'Line 6, /call/tool: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
    ]);
  });

  it.each([[''], ['messages'], ['/messages/~']])('refuses %j as read, as every pointer into an answer', (read) => {
    expect(problemsOf({ ...thread, read })).toEqual([`Line 12, /call/read: ${pointerWords}`]);
  });
});

describe('the arguments of a call block', () => {
  it('refuse a name a call does not read, a template that does not compile, and a ${', () => {
    expect([withChannel('{{ to }}'), withChannel('{{ oops'), withChannel('Bearer ${CHAT_KEY}')]).toEqual([
      ['Line 8, /call/with/channel: Reads to, which a template of a call does not have; it reads input, today and now'],
      [expect.stringMatching(/^Line 8, \/call\/with\/channel: /u)],
      ['Line 8, /call/with/channel: Expected no ${ in a template, which never holds a secret'],
    ]);
  });

  it('refuse a property a closed input schema does not have, and a moment read as an object', () => {
    const closed = { type: 'object', additionalProperties: false, properties: { channel: { type: 'string' } } };

    expect([withChannel('{{ input.thread }}', closed), withChannel('{{ today.year }}')]).toEqual([
      ['Line 8, /call/with/channel: input.thread is not a property of the input schema, which allows no others'],
      ['Line 8, /call/with/channel: today is the date, as YYYY-MM-DD, and has no properties'],
    ]);
  });

  it('refuse a structure among text that reads no input, and take it written | json, alone, or reading the input', () => {
    expect([
      withChannel('In {{ "a,b" | split: "," }}'),
      withChannel('In {{ "a,b" | split: "," | json }}'),
      withChannel('{{ "a,b" | split: "," }}'),
      withChannel('In {{ input }}'),
    ]).toEqual([
      [
        'Line 8, /call/with/channel: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      ],
      [],
      [],
      [],
    ]);
  });
});

describe('the values the arguments of a call block hold', () => {
  it('check every string within a list or an object at its own path', () => {
    expect(problemsOf({ ...thread, with: { blocks: [{ type: 'section', text: 'Hello {{ party }}' }, 3] } })).toEqual([
      'Line 9, /call/with/blocks/0/text: Reads party, which a template of a call does not have; it reads input, today and now',
    ]);
  });

  it('refuse arguments that take more than 256 KiB as JSON, or one that does alone, and leave what only an input renders to the run', () => {
    expect([
      problemsOf({ ...thread, with: { a: timesAThousand(140), b: timesAThousand(140) } }),
      problemsOf({ ...thread, with: { channel: timesAThousand(270) } }),
      withChannel('{{ input.channel | divided_by: 0 }}'),
    ]).toEqual([
      ['Line 7, /call/with: The arguments of the call take 280015 bytes, more than the 262144 a call may send'],
      [
        'Line 8, /call/with/channel: The argument channel of the call renders more than the 262144 bytes a call may send',
      ],
      [],
    ]);
  });
});
