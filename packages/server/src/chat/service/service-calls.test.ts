import type { CalledOnce, ConnectionCall } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { shippedSlackBot } from '../../testing/chat/shipped-slack-bot.ts';
import { answeredWith, unreachable, type ServiceAnswer } from '../../testing/sockets/held-sockets.ts';
import { chatServiceThrough, type ThroughAConnection, type WhereWritten } from './service-calls.ts';

const where: WhereWritten = { id: '1700.2', conversation: 'C1', thread: '1700.1', sender: 'U1', kind: 'mention' };

const noScope: CalledOnce = {
  kind: 'answered',
  mark: 'acts',
  detail: JSON.stringify({ ok: false, error: 'missing_scope' }),
  retryAfterMs: null,
  outcome: 'tool_error',
  answered: { is_error: true, result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 },
};

const failing = (): never => {
  throw new Error('the connection is gone');
};

function through(
  answer: (call: ConnectionCall) => ServiceAnswer | undefined,
  entry = shippedSlackBot(),
  mostBytes = 65_536,
) {
  const calls: ConnectionCall[] = [];
  const parts: ThroughAConnection = {
    org: 'acme',
    connection: { id: 'connection-1', name: 'slack' },
    chat: Option.getOrThrow(Option.fromNullishOr(entry.chat)),
    typing: entry.conversations?.typing,
    failureCodes: entry.failure_codes,
    tools: {
      callAsTheConnection: (call) =>
        Effect.sync(() => {
          calls.push(call);
          return answer(call);
        }),
      mostRequestBytesTo: (server) => (server === 'slack' ? mostBytes : 0),
    },
  };
  return { service: chatServiceThrough(parts), calls, tools: () => calls.map(({ tool }) => tool) };
}

describe("the calls to a person's service, as its entry declares them", () => {
  it('posts an answer in the thread and reads the id of what it posted, and replaces a message it posted', async () => {
    const { service, calls, tools } = through(() => answeredWith({ ok: true, ts: '1700.3' }));

    expect([await service.answered(where, 'Hello'), await service.replaced(where, '1700.3', 'Done')]).toEqual([
      '1700.3',
      true,
    ]);
    expect([tools(), calls.map(({ org, connection }) => [org, connection])]).toEqual([
      ['chat_postMessage', 'chat_update'],
      [
        ['acme', 'connection-1'],
        ['acme', 'connection-1'],
      ],
    ]);
  });

  it('shows a line to the person alone, and posts nothing where the entry declares no such line', async () => {
    const entry = shippedSlackBot();
    const { ephemeral: _ephemeral, ...chat } = Option.getOrThrow(Option.fromNullishOr(entry.chat));
    const undeclared = { ...entry, chat };

    expect([
      await through(() => answeredWith({ ok: true })).service.toldAlone(where, 'Only you'),
      await through(() => answeredWith({ ok: true }), undeclared).service.toldAlone(where, 'Only you'),
    ]).toEqual([true, false]);
  });
});

const laidOut = [{ type: 'actions', elements: [{ type: 'button', url: 'https://auto.example.com/l/1' }] }];

const topLevel: WhereWritten = { ...where, thread: undefined };

type Thread = Readonly<Record<string, string>>;

function inputsOf(calls: readonly ConnectionCall[]) {
  return calls.map(({ input }) => input);
}

describe("where a person's service is told to post, as its entry declares it", () => {
  it.each([
    ['a mention outside a thread', topLevel, { thread_ts: '1700.2' }],
    ['a message in a thread', where, { thread_ts: '1700.1' }],
    ['a direct message outside a thread', { ...topLevel, kind: 'direct_message' }, {}],
  ] as const)(
    'posts the answer after %s in its thread, or in the conversation of a direct message in none, and a line laid out there',
    async (_, at: WhereWritten, thread: Thread) => {
      const { service, calls } = through(() => answeredWith({ ok: true, ts: '1700.3' }));

      await service.answered(at, 'Hello');
      await service.answered(at, { text: 'Sign in', payload: laidOut });

      expect(inputsOf(calls)).toEqual([
        { body: { channel: 'C1', ...thread, markdown_text: 'Hello' } },
        { body: { channel: 'C1', ...thread, text: 'Sign in', blocks: laidOut } },
      ]);
    },
  );

  it.each([
    ['a mention outside a thread', topLevel, {}],
    ['a message in a thread', where, { thread_ts: '1700.1' }],
  ] as const)(
    'shows a line to the person alone after %s, in its thread only where it is in one',
    async (_, at: WhereWritten, thread: Thread) => {
      const { service, calls } = through(() => answeredWith({ ok: true }));

      await service.toldAlone(at, 'Only you');

      expect(inputsOf(calls)).toEqual([{ body: { channel: 'C1', user: 'U1', ...thread, text: 'Only you' } }]);
    },
  );
});

describe("what Auto reads at a person's service, as its entry declares it", () => {
  it('reads the messages of a thread in their order, and leaves out what holds no id or no words', async () => {
    const messages = [
      { ts: '1700.1', user: 'U1', text: 'Start' },
      { ts: '1700.2', bot_id: 'B1', text: 'From an app' },
      { ts: '1700.3', user: 'U2' },
      { user: 'U3', text: 'No id' },
    ];
    const { service } = through(() => answeredWith({ ok: true, messages }));

    expect(await service.thread(where)).toEqual([
      { id: '1700.1', sender: 'U1', text: 'Start', automatic: undefined },
      { id: '1700.2', sender: undefined, text: 'From an app', automatic: 'B1' },
    ]);
    expect(await through(() => answeredWith({ ok: true })).service.thread(where)).toEqual([]);
  });
});

function declaringLeast() {
  const entry = shippedSlackBot();
  const declared = Option.getOrThrow(Option.fromNullishOr(entry.chat));
  return {
    ...entry,
    chat: {
      ...declared,
      thread: {
        ...declared.thread,
        read: { list: '/messages', order: 'newest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
      },
      sender: {
        tool: declared.sender.tool,
        with: declared.sender.with,
        email: '/user/profile/email',
        name: '/user/real_name',
      },
    },
  } as const;
}

describe("what Auto reads at a person's service, where its entry declares little", () => {
  it('reads a thread listed newest first, and a person by an address it counts as not confirmed, where the entry declares no more', async () => {
    const least = declaringLeast();
    const messages = [
      { ts: '1700.2', user: 'U2', text: 'Second' },
      { ts: '1700.1', user: 'U1', text: 'First' },
    ];
    const answer = { ok: true, messages, user: { profile: { email: 'ada@example.com' } } };
    const { service } = through(() => answeredWith(answer), least);

    expect([(await service.thread(where)).map(({ id }) => id), await service.sender(where)]).toEqual([
      ['1700.1', '1700.2'],
      { email: 'ada@example.com', verified: false, account: undefined, active: true, name: undefined },
    ]);
  });

  it.each([
    ['a confirmed address of an active person', { is_email_confirmed: true }, true, true],
    ['an address not confirmed', { is_email_confirmed: false }, false, true],
    ['a person who was deactivated', { is_email_confirmed: true, deleted: true }, true, false],
    ['an app', { is_email_confirmed: true, is_bot: true }, true, false],
    ['a person whose state the service gave as a number', { is_email_confirmed: true, deleted: 0 }, true, false],
  ] as const)('reads the person who wrote: %s', async (_, user, verified, active) => {
    const answer = {
      ok: true,
      user: { team_id: 'T1', real_name: 'Ada', profile: { email: 'ada@example.com' }, ...user },
    };
    const { service } = through(() => answeredWith(answer));

    expect(await service.sender(where)).toEqual({
      email: 'ada@example.com',
      verified,
      account: 'T1',
      active,
      name: 'Ada',
    });
  });
});

describe("what a person's service did not answer, or Auto could not show", () => {
  it('reads nothing where the service could not be reached, the call failed, the arguments do not fit, or the organization holds the connection no longer', async () => {
    expect([
      await through(() => unreachable).service.sender(where),
      await through(() => noScope).service.sender(where),
      await through(failing).service.sender(where),
      await through(() => answeredWith({ ok: true }), shippedSlackBot(), 1).service.answered(where, 'Hello'),
      await through(() => {}).service.sender(where),
      await through(() => {}).service.typing(where),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, 'failed']);
  });

  it('shows that Auto is working where the entry declares it, says refused where the service shows none there, and refused where nothing is declared', async () => {
    const { conversations: _conversations, ...untyped } = shippedSlackBot();

    expect([
      await through(() => answeredWith({ ok: true })).service.typing(where),
      await through(() => answeredWith({ ok: true })).service.typing({ ...where, thread: undefined }),
      await through(() => noScope).service.typing(where),
      await through(() => answeredWith({ ok: true }), untyped).service.typing({ ...where, thread: undefined }),
    ]).toEqual(['shown', 'shown', 'refused', 'refused']);
  });
});
