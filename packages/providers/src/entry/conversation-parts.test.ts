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

describe('the conversations part of an entry', () => {
  it('is taken whole, with a way to reply alone or a way to mark as well, for all or refusals', () => {
    expect([
      partProblems({ tell: 'all', reply, react }),
      partProblems({ tell: 'refusals', reply }),
      problemsOf(tracker),
    ]).toEqual([[], [], []]);
  });

  it('refuses a tool that is no tool name and a sent that is no pointer into the answer, each at its place', () => {
    expect(
      partProblems({
        tell: 'all',
        reply: { ...reply, tool: 'post message', sent: 'ts' },
        react: { ...react, tool: '' },
      }),
    ).toEqual([
      ['/conversations/reply/tool', 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots'],
      [
        '/conversations/reply/sent',
        'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1',
      ],
      ['/conversations/react/tool', 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots'],
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
