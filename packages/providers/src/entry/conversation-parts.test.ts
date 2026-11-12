import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { tracker } from '../testing/fixture-providers.ts';

const reply = {
  tool: 'post_message',
  with: { channel: '{{ sent.conversation }}', thread: '{{ reply.to | default: reply.id }}', text: '{{ message }}' },
  sent: '/ts',
};

const react = {
  tool: 'add_reaction',
  with: { channel: '{{ sent.conversation }}', message: '{{ reply.id }}', name: 'white_check_mark' },
};

function partProblems(conversations: unknown) {
  return problemsOf({ ...tracker, conversations });
}

const noPointer =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

const noToolName = 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots';

describe('the conversations part of an entry', () => {
  it('is taken whole, with a way to reply alone or a way to mark as well, for all or refusals', () => {
    expect([
      partProblems({ tell: 'all', reply, react }),
      partProblems({ tell: 'refusals', reply }),
      problemsOf(tracker),
    ]).toEqual([[], [], []]);
  });

  it('refuses a tool that is no tool name, and a sent or an automatic that is no pointer, each at its place', () => {
    expect(
      partProblems({
        tell: 'all',
        reply: { ...reply, tool: 'post message', sent: 'ts' },
        react: { ...react, tool: '' },
        automatic: 'bot_id',
      }),
    ).toEqual([
      ['/conversations/reply/tool', noToolName],
      ['/conversations/reply/sent', noPointer],
      ['/conversations/automatic', noPointer],
      ['/conversations/react/tool', noToolName],
    ]);
  });

  it('refuses an argument that reads what a conversation does not have, or is no template, at the argument', () => {
    const problems = partProblems({
      tell: 'all',
      reply: { ...reply, with: { ...reply.with, text: '{{ input.note }}' } },
      react: { ...react, with: { ...react.with, name: '{% if %}' } },
    });

    expect(problems).toEqual([
      [
        '/conversations/reply/with/text',
        'Reads input, which a template of a conversation does not have; it reads to, sent.conversation, sent.id, message, reply.id and reply.to',
      ],
      ['/conversations/react/with/name', 'invalid value expression: ""'],
    ]);
  });

  it('refuses a part that says neither all nor refusals, or names no way to reply', () => {
    expect(partProblems({ tell: 'none', react })).toEqual([
      ['/conversations/tell', 'Expected "all" | "refusals"'],
      ['/conversations/reply', 'Missing key'],
    ]);
  });
});

describe('the read limit of a conversations part', () => {
  it('takes a read limit of a quota and a window, and refuses one of no reads, no window or a window past a day', () => {
    expect([
      partProblems({ tell: 'all', reply, read_limit: { quota: 1, window_seconds: 60 } }),
      partProblems({ tell: 'all', reply, read_limit: { quota: 0, window_seconds: 0 } }),
      partProblems({ tell: 'all', reply, read_limit: { quota: 1.5, window_seconds: 86_401 } }),
      partProblems({ tell: 'all', reply, read_limit: { quota: 1, window_seconds: 60, clients: [] } }),
    ]).toEqual([
      [],
      [
        ['/conversations/read_limit/quota', 'Expected a value greater than or equal to 1'],
        ['/conversations/read_limit/window_seconds', 'Expected a value greater than or equal to 1'],
      ],
      [
        ['/conversations/read_limit/quota', 'Expected an integer'],
        ['/conversations/read_limit/window_seconds', 'Expected a value less than or equal to 86400'],
      ],
      [['/conversations/read_limit/clients', 'Expected a value with a length of at least 1']],
    ]);
  });
});
