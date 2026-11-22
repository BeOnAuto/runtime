import { answererId, recordsOf, theChannel } from '@on.auto/interaction/testing';
import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { answeredWith, chatMemberIn, socketProviders, unreachable } from '../testing/sockets/held-sockets.ts';
import { inTestTime, settled } from '../testing/sockets/in-test-time.ts';
import { askedRun, repliesWaiting, secondsAfter, T0, type RepliesWaiting } from '../testing/sockets/replies-waiting.ts';
import { repliesTakenBy, type CarriedReply, type SocketReplies } from './socket-replies.ts';

type Member = ReturnType<typeof chatMemberIn>;

interface Written {
  readonly thread?: string;
  readonly user?: string;
  readonly team?: string;
  readonly text?: string;
  readonly ts?: string;
}

interface Replied {
  readonly member: Member;
  readonly carried: CarriedReply;
}

/** A reply read from a message of a workspace, in the thread of the request by its answerer unless told otherwise. */
function repliedIn(waiting: RepliesWaiting, member: Member, written: Written = {}): Replied {
  const { thread = waiting.thread, user = answererId, team = 'T1', text = 'approve', ts = secondsAfter(30) } = written;
  const reply = { account: team, id: ts, sender: user, text, to: thread, time: ts };
  return { member, carried: { conversation: theChannel, reply, now: T0 + 60_000 } };
}

const ofTheChats = chatMemberIn('T1', 'chats');

const ofTheApiIn = (workspace: string) => chatMemberIn(workspace, 'chats-api');

/** The replies taken in turn by the reply branch of a server, each left to settle, and the lines logged meanwhile. */
async function takenInTurn(replies: SocketReplies, replied: readonly Replied[]): Promise<readonly string[]> {
  const logged: string[] = [];
  await inTestTime(
    (context) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(T0 + 60_000);
        const taking = repliesTakenBy({ replies, registries: { providers: socketProviders }, context });
        for (const { member, carried } of replied) {
          yield* taking.taken(member, carried);
          yield* settled;
        }
        yield* taking.stop();
      }),
    (line) => {
      logged.push(line);
    },
  );
  return logged;
}

function decidedIn({ playbook }: RepliesWaiting) {
  return recordsOf(playbook.ledger, 'request_answered');
}

function answeredAnError(document: object): CalledOnce {
  return {
    kind: 'answered',
    mark: 'acts',
    detail: JSON.stringify(document),
    retryAfterMs: null,
    outcome: 'tool_error',
    answered: { is_error: true, result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 },
  };
}

const aRefusedKey: CalledOnce = {
  kind: 'answered',
  mark: 'acts',
  detail: 'The tool server answered invalid_auth',
  retryAfterMs: null,
  outcome: 'server_failure',
  because: 'key_refused',
  failed: { because: 'server_failure', duration_ms: 1, jsonrpc_id: 1 },
};

const taken = { type: 'request_answered', data: { answer: { choice: 'approve' }, delivered: true } } as const;

function linesNamingTheReply(logged: readonly string[]): readonly string[] {
  return logged.filter((line) => line.includes('approve') || line.includes(answererId));
}

function linesOfTheConnection(logged: readonly string[], level: string): readonly string[] {
  return logged.filter(
    (line) =>
      line.includes(`"level":"${level}"`) &&
      line.includes('"connection":"connection-chat"') &&
      line.includes('"org":"acme"'),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the working status under a reply a request waits for', () => {
  it('is asked for once, through the connection of the request, its arguments rendered for the request’s thread and party', async () => {
    const waiting = await repliesWaiting();

    await takenInTurn(waiting.replies, [repliedIn(waiting, ofTheChats)]);

    expect(waiting.statuses.asked()).toEqual([
      {
        at: ['acme', 'alpha', 'chat'],
        tool: 'set_status',
        input: { channel: theChannel, thread: waiting.thread, to: theChannel, status: 'is working' },
      },
    ]);
    expect(await decidedIn(waiting)).toMatchObject([taken]);
  });

  it.each([
    ['a reply in a thread no request was sent as', [{ thread: secondsAfter(1) }], 0],
    ['a reply of someone the request does not wait for', [{ user: 'U0SOMEONE' }], 0],
    ['a reply of a workspace the connection is not in', [{ team: 'T2' }], 0],
    ['the same reply twice, the second seen already', [{}, {}], 1],
    ['a reply after an earlier one answered the request', [{}, { ts: secondsAfter(40), text: 'approve too' }], 1],
  ] as const)('is asked for no more than once all told, for %s', async (_, written, times) => {
    const waiting = await repliesWaiting();

    await takenInTurn(
      waiting.replies,
      written.map((each) => repliedIn(waiting, ofTheChats, each)),
    );

    expect(waiting.statuses.asked()).toHaveLength(times);
  });
});

describe('a working status the server cannot ask for', () => {
  it('is not asked for where the answer about the reply names no party to render it for, and the reply is taken all the same', async () => {
    const waiting = await repliesWaiting();
    const namingNoParty: SocketReplies = {
      ...waiting.replies,
      awaited: (place, reply) =>
        Effect.map(waiting.replies.awaited(place, reply), ({ awaited, typing }) => ({ awaited, typing })),
    };

    await takenInTurn(namingNoParty, [repliedIn(waiting, ofTheChats)]);

    expect(waiting.statuses.asked()).toEqual([]);
    expect(await decidedIn(waiting)).toMatchObject([taken]);
  });

  it('is not asked for through a connection whose entry declares no way to show it, and the reply is taken all the same', async () => {
    const waiting = await repliesWaiting();

    await takenInTurn(waiting.replies, [repliedIn(waiting, chatMemberIn('T1', 'tracker'))]);

    expect(waiting.statuses.asked()).toEqual([]);
    expect(await decidedIn(waiting)).toMatchObject([taken]);
  });
});

describe('a working status the service does not show', () => {
  it.each([
    ['answers an error whose code the entry does not list', Effect.succeed(answeredAnError({ ok: false, error: 'x' }))],
    ['cannot be reached', Effect.succeed(unreachable)],
    ['fails', Effect.die(new Error('the status could not be sent'))],
  ] as const)(
    'where the call %s leaves the reply taken and the run carried on, logged by its org and connection and none of the reply’s words',
    async (_, answer) => {
      const waiting = await repliesWaiting(answer);

      const logged = await takenInTurn(waiting.replies, [repliedIn(waiting, ofTheChats)]);
      await waiting.playbook.performDue(T0 + 60_000);

      expect(waiting.statuses.asked()).toHaveLength(1);
      expect(await decidedIn(waiting)).toMatchObject([taken]);
      expect(await waiting.playbook.runOf(askedRun)).toMatchObject({ output: { status: 'succeeded' } });
      expect(linesOfTheConnection(logged, 'WARN')).toHaveLength(1);
      expect(linesNamingTheReply(logged)).toEqual([]);
    },
  );
});

describe('the accounts where the service shows no working status', () => {
  it.each([
    ['an error whose code the entry lists', answeredAnError({ ok: false, error: 'feature_disabled' })],
    ['a refused key, every code of which the entry lists', aRefusedKey],
  ] as const)(
    'take in an account once the service answers %s, so it is not asked there again and still is in another',
    async (_, answer) => {
      const waiting = await repliesWaiting(Effect.succeed(answer));

      const logged = await takenInTurn(waiting.replies, [
        repliedIn(waiting, ofTheApiIn('T1'), { text: 'maybe', ts: secondsAfter(30) }),
        repliedIn(waiting, ofTheApiIn('T1'), { text: 'maybe', ts: secondsAfter(31) }),
        repliedIn(waiting, ofTheApiIn('T2'), { text: 'maybe', ts: secondsAfter(32), team: 'T2' }),
      ]);

      expect(waiting.statuses.asked().map(({ input }) => input['thread'])).toEqual([waiting.thread, waiting.thread]);
      expect(linesOfTheConnection(logged, 'INFO')).toHaveLength(1);
    },
  );

  it('take in no account for an answer the entry does not list, so the next reply asks again', async () => {
    const waiting = await repliesWaiting(Effect.succeed(answeredAnError({ ok: false, error: 'ratelimited' })));

    await takenInTurn(waiting.replies, [
      repliedIn(waiting, ofTheApiIn('T1'), { text: 'maybe', ts: secondsAfter(30) }),
      repliedIn(waiting, ofTheApiIn('T1'), { text: 'maybe', ts: secondsAfter(31) }),
    ]);

    expect(waiting.statuses.asked()).toHaveLength(2);
  });

  it('take in no account where the service showed it, so the next reply asks again', async () => {
    const waiting = await repliesWaiting(Effect.succeed(answeredWith({ ok: true })));

    await takenInTurn(waiting.replies, [
      repliedIn(waiting, ofTheApiIn('T1'), { text: 'maybe', ts: secondsAfter(30) }),
      repliedIn(waiting, ofTheApiIn('T1'), { text: 'maybe', ts: secondsAfter(31) }),
    ]);

    expect(waiting.statuses.asked()).toHaveLength(2);
  });
});
