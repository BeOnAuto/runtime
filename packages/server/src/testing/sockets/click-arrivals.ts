import { answererId, theChannel } from '@on.auto/interaction/testing';
import { Effect, type Context } from 'effect';
import { TestClock } from 'effect/testing';
import { expect } from 'vitest';

import { chatIn } from './held-sockets.ts';
import { inTestTime, settled } from './in-test-time.ts';
import { T0 } from './replies-waiting.ts';
import type { SocketsOverALedger } from './sockets-over-a-ledger.ts';

const appCredential = 'xapp-chats';

interface Clicked {
  readonly time?: string;
  readonly action?: string;
  readonly channel?: string;
}

export function clickOf(
  team: string,
  thread: string,
  { time = '1699.5', action = 'auto-answer:1a2b', channel = theChannel }: Clicked = {},
) {
  const actions = [{ action_id: action, action_ts: time }];
  const payload = {
    team_id: team,
    type: 'block_actions',
    user: { id: answererId },
    channel: { id: channel },
    container: { message_ts: thread },
    actions,
  };
  return { type: 'interactive', envelope_id: `e-${time}`, payload };
}

export type Server = Readonly<Pick<SocketsOverALedger, 'recorded' | 'started' | 'sends' | 'acknowledged' | 'wakes'>>;

export function conversationsWoken(server: Server): readonly (string | undefined)[] {
  return server.wakes
    .heard()
    .map(({ conversation }) => conversation)
    .filter((conversation) => conversation !== undefined);
}

export function warnedOf(logged: readonly string[]): readonly string[] {
  return logged.filter((line) => line.includes('"level":"WARN"') && line.includes('"org":"acme"'));
}

function startedIn(server: Server, context: Context.Context<never>) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(T0 + 60_000);
    const wakeUp = server.started(context);
    yield* wakeUp.wakeUp({ now: T0 + 60_000, sweep: false });
    yield* settled;
    return wakeUp;
  });
}

export function sentOver(
  server: Server,
  messages: readonly object[],
  workspace: string,
  logged?: (line: string) => void,
) {
  return inTestTime(
    (context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', chatIn(workspace));
        const wakeUp = yield* startedIn(server, context);
        for (const message of messages) {
          yield* server.sends(appCredential, message);
          yield* settled;
        }
        expect(server.acknowledged(appCredential)).toHaveLength(messages.length);
        yield* wakeUp.stop();
      }),
    logged,
  );
}
