import { playbooksWaitingIn, replyAwaited, replyDelivery } from '@on.auto/interaction';
import {
  answererId,
  chatConversations,
  chatHarness,
  recordsOf,
  theChannel,
  threadDocument,
  threadRepliesTelling,
  type ChatHarness,
} from '@on.auto/interaction/testing';
import { Effect, type Context } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatIn } from '../testing/sockets/held-sockets.ts';
import { inTestTime, settled } from '../testing/sockets/in-test-time.ts';
import { SocketsOverALedger } from '../testing/sockets/sockets-over-a-ledger.ts';
import type { SocketReplies } from './socket-replies.ts';

const T0 = Date.parse('2026-11-22T09:00:00.000Z');

const askedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b91';

const appCredential = 'xapp-chats';

interface Written {
  readonly thread?: string;
  readonly user?: string;
  readonly team?: string;
  readonly text?: string;
  readonly ts?: string;
  readonly hidden?: boolean;
}

/** Seconds after T0, as a chat writes a message's id and time. */
function secondsAfter(seconds: number): string {
  return `${T0 / 1000 + seconds}.000100`;
}

interface Waiting {
  readonly playbook: ChatHarness;
  readonly thread: string;
  readonly server: SocketsOverALedger;
  readonly written: (written?: Written) => object;
}

/** A request of the chat harness sent at T0 through the connection named chat, and the sockets of a server beside it. */
async function waitingForAReply(): Promise<Waiting> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const playbook = await chatHarness({
    conversations: chatConversations,
    document: threadDocument({ replies: threadRepliesTelling() }),
  });
  await playbook.askInThread(askedRun);
  await playbook.performDue(T0);
  const thread = playbook.chat.posted()[0]?.ts ?? '';
  const ledger = playbook.ledger.service;
  const server = new SocketsOverALedger();
  server.takesRepliesBy({
    waitingIn: playbooksWaitingIn({ ledger }),
    awaited: replyAwaited({ ledger }),
    delivered: replyDelivery({ ledger, tools: playbook.chat, record: playbook.record }),
  });
  return {
    playbook,
    thread,
    server,
    written: ({
      thread: inThread = thread,
      user = answererId,
      team = 'T1',
      text = 'approve',
      ts = secondsAfter(30),
      hidden = false,
    } = {}) => {
      const event = { channel: theChannel, user, text, ts, thread_ts: inThread, ...(hidden ? { hidden } : {}) };
      return { type: 'events_api', envelope_id: `e-${ts}`, payload: { team_id: team, event } };
    },
  };
}

type Server = Readonly<Pick<SocketsOverALedger, 'recorded' | 'started' | 'sends' | 'acknowledged' | 'wakes'>>;

function startedIn(server: Server, context: Context.Context<never>) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(T0 + 60_000);
    const wakeUp = server.started(context);
    yield* wakeUp.wakeUp({ now: T0 + 60_000, sweep: false });
    yield* settled;
    return wakeUp;
  });
}

function sentInTurn(server: Server, messages: readonly object[]) {
  return Effect.gen(function* () {
    for (const message of messages) {
      yield* server.sends(appCredential, message);
      yield* settled;
    }
  });
}

function decidedIn(playbook: ChatHarness) {
  return recordsOf(playbook.ledger, 'request_answered', 'reply_refused');
}

const answered = { type: 'request_answered', data: { answer: { choice: 'approve' }, delivered: true } } as const;

const refused = { type: 'reply_refused', data: { because: 'not_the_answerer', delivered: true } } as const;

function conversationsWoken(server: Server): readonly (string | undefined)[] {
  return server.wakes
    .heard()
    .map(({ conversation }) => conversation)
    .filter((conversation) => conversation !== undefined);
}

afterEach(() => {
  vi.useRealTimers();
});

/** The messages sent down the chats socket in turn, each acknowledged, through a connection recorded in a workspace if given. */
function arrivedThrough(
  server: Server,
  messages: readonly object[],
  workspace?: string,
  logged?: (line: string) => void,
) {
  return inTestTime(
    (context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', chatIn(workspace));
        const wakeUp = yield* startedIn(server, context);

        yield* sentInTurn(server, messages);

        expect(server.acknowledged(appCredential)).toHaveLength(messages.length);
        yield* wakeUp.stop();
      }),
    logged,
  );
}

describe('a reply that arrives over a socket', () => {
  it.each([
    ['in the thread of the request, by its answerer, is taken as it arrives, and nothing is woken', {}, [answered], []],
    [
      'in a thread no request was sent as wakes as before, and nothing is taken',
      { thread: secondsAfter(1) },
      [],
      [theChannel],
    ],
    [
      'in another workspace than the connection’s wakes as before, and nothing is taken',
      { team: 'T2' },
      [],
      [theChannel],
    ],
    ['that is an edit carries no reply, so it wakes as before', { hidden: true }, [], [theChannel]],
    [
      'by someone the request does not wait for answers nothing, and is refused as theirs',
      { user: 'U0SOMEONE' },
      [refused],
      [],
    ],
    ['whose time the message does not give is taken as written when it arrived', { ts: 'unwritten' }, [answered], []],
  ] as const)('%s', async (_, written, decided, woken) => {
    const waiting = await waitingForAReply();

    await arrivedThrough(waiting.server, [waiting.written(written)], 'T1');

    expect(await decidedIn(waiting.playbook)).toMatchObject(decided);
    expect(conversationsWoken(waiting.server)).toEqual(woken);
  });
});

describe('a reply that arrives over a socket twice', () => {
  it.each([
    [
      'an answer, taken once, the second waking as before since nothing waits for it any more',
      {},
      [answered],
      [theChannel],
    ],
    [
      'a reply refused, refused once, the second passed over by its id with nothing woken',
      { user: 'U0SOMEONE' },
      [refused],
      [],
    ],
  ] as const)('is %s', async (_, written, decided, woken) => {
    const waiting = await waitingForAReply();

    await arrivedThrough(waiting.server, [waiting.written(written), waiting.written(written)], 'T1');

    expect(await decidedIn(waiting.playbook)).toMatchObject(decided);
    expect(conversationsWoken(waiting.server)).toEqual(woken);
  });
});

describe('a reply that arrives over a socket before the account of its connection is known, or that cannot be taken', () => {
  it('through a connection whose account is not recorded yet is not taken, and wakes as before', async () => {
    const waiting = await waitingForAReply();

    await arrivedThrough(waiting.server, [waiting.written()]);

    expect(await decidedIn(waiting.playbook)).toEqual([]);
    expect(conversationsWoken(waiting.server)).toEqual([theChannel]);
  });

  it('that cannot be taken as it arrives wakes as before, is acknowledged, and is logged with its org and connection and none of its words', async () => {
    const waiting = await waitingForAReply();
    const failing: SocketReplies = {
      waitingIn: () => Effect.die(new Error('the ledger is down')),
      awaited: () => Effect.die('a reply was asked about'),
      delivered: () => Effect.die('a reply was delivered'),
    };
    waiting.server.takesRepliesBy(failing);
    const logged: string[] = [];

    await arrivedThrough(waiting.server, [waiting.written()], 'T1', (line) => {
      logged.push(line);
    });
    const warned = logged.filter((line) => line.includes('"level":"WARN"'));
    const ofTheConnection = warned.filter((line) => line.includes('"connection":"connection-chat"'));

    expect(conversationsWoken(waiting.server)).toEqual([theChannel]);
    expect(ofTheConnection.filter((line) => line.includes('"org":"acme"'))).toHaveLength(1);
    expect(logged.filter((line) => line.includes('approve'))).toEqual([]);
  });
});

describe('a reply that arrives over a socket, through to its run', () => {
  it('answers the request it waits for, so the run carries on and succeeds once the due work settles it', async () => {
    const waiting = await waitingForAReply();

    await arrivedThrough(waiting.server, [waiting.written({ text: 'approve, looks good' })], 'T1');
    await waiting.playbook.performDue(T0 + 60_000);

    expect(await waiting.playbook.runOf(askedRun)).toMatchObject({ output: { status: 'succeeded' } });
  });
});
