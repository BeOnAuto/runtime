import { describe, expect, it } from 'vitest';

import { aliasesTakenIn, providerNamesOf } from '../index.ts';
import { decodedEntry, problemsOf } from '../testing/entry-problems.ts';
import { messages, tracker } from '../testing/fixture-providers.ts';

function replacing(replaces: unknown) {
  return { ...messages, replaces };
}

describe('the providers an entry replaces', () => {
  it('are named by their names, and left out where it replaces none', () => {
    expect(decodedEntry(replacing(['chat', 'chat-bot'])).replaces).toEqual(['chat', 'chat-bot']);
    expect(decodedEntry(messages).replaces).toBeUndefined();
    expect(problemsOf(replacing(['chat']))).toEqual([]);
  });

  it('are at least one, each a provider’s name, never the entry’s own, each once', () => {
    expect(problemsOf(replacing([]))).toEqual([['/replaces', 'Expected a value with a length of at least 1']]);
    expect(problemsOf(replacing(['Chat', 'messages', 'chat', 'chat']))).toEqual([
      ['/replaces/0', 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter'],
      ['/replaces/1', 'Expected another provider: a provider does not replace itself'],
      ['/replaces/3', 'Expected each provider once'],
    ]);
  });
});

function aliased(aliases: unknown) {
  return { ...tracker, aliases };
}

describe('the other names an entry is found by', () => {
  it('are names of providers, after its own, and left out where it has none', () => {
    expect(decodedEntry(aliased(['issues', 'tickets'])).aliases).toEqual(['issues', 'tickets']);
    expect(providerNamesOf(decodedEntry(aliased(['issues', 'tickets'])))).toEqual(['tracker', 'issues', 'tickets']);
    expect(decodedEntry(tracker).aliases).toBeUndefined();
    expect(providerNamesOf(tracker)).toEqual(['tracker']);
    expect(problemsOf(aliased(['issues']))).toEqual([]);
  });

  it('are at least one, each a provider’s name, never the entry’s own, each once', () => {
    expect(problemsOf(aliased([]))).toEqual([['/aliases', 'Expected a value with a length of at least 1']]);
    expect(problemsOf(aliased(['Issues', 'tracker', 'issues', 'issues']))).toEqual([
      ['/aliases/0', 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter'],
      ['/aliases/1', "Expected another name: the provider's own name finds it already"],
      ['/aliases/3', 'Expected each name once'],
    ]);
  });

  it('are never a name of a provider it replaces', () => {
    expect(problemsOf({ ...tracker, aliases: ['issues', 'tickets'], replaces: ['tickets'] })).toEqual([
      [
        '/aliases/1',
        'Expected a name the provider does not replace: a provider is not found by the name of one it replaces',
      ],
    ]);
  });
});

describe('the names of a list of entries', () => {
  it('find one entry each: an alias that is another entry’s name or alias is taken, at each entry that has it', () => {
    const entries = [
      { name: 'tracker', aliases: ['issues', 'notes'] },
      { name: 'notes' },
      { name: 'tickets', aliases: ['issues', 'tasks'] },
    ];

    expect(aliasesTakenIn(entries)).toEqual([
      {
        entry: 0,
        at: 0,
        detail: 'Expected a name no other provider is found by: the provider tickets is found by issues',
      },
      {
        entry: 0,
        at: 1,
        detail: 'Expected a name no other provider is found by: the provider notes is found by notes',
      },
      {
        entry: 2,
        at: 0,
        detail: 'Expected a name no other provider is found by: the provider tracker is found by issues',
      },
    ]);
    expect(aliasesTakenIn([{ name: 'tracker', aliases: ['issues'] }, { name: 'notes' }])).toEqual([]);
  });
});

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
