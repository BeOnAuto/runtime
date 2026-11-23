import { resultOf } from '@on.auto/chat/testing';
import type { ChatMessage } from '@on.auto/providers';
import { Effect, Schema, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SocketMember } from '../../sockets/socket-registries.ts';
import { answeredAfterAWait, typingThatFailsAfterTheFirst } from '../../testing/chat/chat-fakes.ts';
import { chatScene, type ChatScene } from '../../testing/chat/chat-scenes.ts';
import { chatMemberIn } from '../../testing/sockets/held-sockets.ts';
import { inTestTime } from '../../testing/sockets/in-test-time.ts';
import { chatSocketsOf } from './chat-sockets.ts';

const member = chatMemberIn('T1', 'chats');

const recognised = {
  service: { sender: { email: 'a@x', verified: true, account: 'T1', active: true, name: 'Ada' } },
  verified: { 'a@x': 'ada' },
} as const;

const memberSharingTheAccount: SocketMember = { ...member, holder: { ...member.holder, connection: 'connection-0' } };

const levelOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ level: Schema.String })));

const outcomeOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ annotations: Schema.Struct({ outcome: Schema.String }) })),
);

const aMention: ChatMessage = {
  kind: 'mention',
  id: '1700.2',
  conversation: 'C1',
  sender: 'U1',
  account: 'T1',
  text: 'How are the sales?',
  shared: false,
};

function socketsOf(scene: ChatScene, connected = true) {
  return chatSocketsOf({
    serving: scene.serving,
    connectionOf: () => Promise.resolve(connected ? scene.connection : undefined),
  }).served();
}

describe('the chat beside the sockets', () => {
  it('claims a message it takes, answers it after the arrival returns, and logs what came of it', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Up.')] } });
    const { promise: logged, resolve } = Promise.withResolvers<string>();

    await inTestTime(
      (context) =>
        Effect.gen(function* () {
          const sockets = chatSocketsOf(
            { serving: scene.serving, connectionOf: () => Promise.resolve(scene.connection) },
            context,
          ).served();
          yield* sockets.arrived([member], aMention);
          yield* Effect.promise(() => logged);
          yield* sockets.stop();
        }),
      resolve,
    );

    expect([scene.fake.said.at(-1)?.text, outcomeOf(await logged).annotations.outcome]).toEqual(['Up.', 'answered']);
  });

  it('takes a message through one connection, the first by its id, where several connections share its account', async () => {
    const scene = chatScene();
    const asked: string[] = [];
    const sockets = chatSocketsOf({
      serving: scene.serving,
      connectionOf: ({ holder }) => {
        asked.push(holder.connection);
        return Effect.runPromise(Effect.undefined);
      },
    }).served();

    await Effect.runPromise(sockets.arrived([member, memberSharingTheAccount], aMention));
    await Effect.runPromise(sockets.stop());

    expect(asked).toEqual(['connection-0']);
  });
});

describe('the chat beside the sockets, passing a message over', () => {
  it.each([
    ['no message', undefined, [member], true],
    ['a message of another account', { ...aMention, account: 'T2' }, [member], true],
    ['a message of no account', Struct.omit(aMention, ['account']), [member], true],
    ['a message through a connection that offers no chat', aMention, [member], false],
    ['a message whose route passes it over', { ...aMention, text: ' ' }, [member], true],
  ] as const)('takes nothing for %s', async (_, message, members, connected) => {
    const scene = chatScene();
    const sockets = socketsOf(scene, connected);

    await Effect.runPromise(sockets.arrived(members, message));
    await Effect.runPromise(sockets.stop());

    expect(await scene.store.arrivals.unsettled()).toEqual([]);
  });
});

describe('the chat beside the sockets, sent a message again', () => {
  it('takes a message once, however often the service sends it', async () => {
    const scene = chatScene();
    await scene.store.arrivals.claimed({
      connection: member.holder.connection,
      account: 'T1',
      conversation: aMention.conversation,
      message: aMention.id,
      kind: aMention.kind,
    });
    const sockets = socketsOf(scene);

    await Effect.runPromise(sockets.arrived([member], aMention));
    await Effect.runPromise(sockets.stop());

    expect(scene.fake.said).toEqual([]);
  });
});

const leftUnanswered = {
  connection: member.holder.connection,
  account: 'T1',
  conversation: 'C1',
  message: '1700.9',
  kind: 'mention',
};

describe('the chat beside the sockets, after a restart', () => {
  it('takes a message once, and tells once after a restart what it left unanswered', async () => {
    const scene = chatScene();
    const arrival = leftUnanswered;
    await scene.store.arrivals.claimed(arrival);
    await scene.store.arrivals.claimed({ ...arrival, message: '1700.8', connection: 'gone' });
    const sockets = socketsOf(scene);

    await Effect.runPromise(sockets.restarted([member]));
    await Effect.runPromise(sockets.restarted([member]));
    await Effect.runPromise(sockets.stop());

    expect([scene.fake.calls(), await scene.store.arrivals.unsettled()]).toEqual([['answered'], []]);
  });

  it('logs what it could not read or take, and goes on', async () => {
    const scene = chatScene();
    const failing = {
      ...scene.serving.store,
      arrivals: {
        ...scene.serving.store.arrivals,
        unsettled: () => Promise.reject(new Error('no table')),
        claimed: () => Promise.reject(new Error('no table')),
      },
    };
    const sockets = chatSocketsOf({
      serving: { ...scene.serving, store: failing },
      connectionOf: () => Promise.resolve(scene.connection),
    }).served();

    await Effect.runPromise(sockets.restarted([member]));
    await Effect.runPromise(sockets.arrived([member], aMention));
    await Effect.runPromise(sockets.stop());

    expect(scene.fake.said).toEqual([]);
  });
});

describe('the chat beside the sockets, once they stop and serve again', () => {
  it('answers a message, and tells again what a restart left unanswered since it last served', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Up.')] } });
    const { promise: logged, resolve } = Promise.withResolvers<string>();
    await scene.store.arrivals.claimed(leftUnanswered);

    await inTestTime(
      (context) =>
        Effect.gen(function* () {
          const chat = chatSocketsOf(
            { serving: scene.serving, connectionOf: () => Promise.resolve(scene.connection) },
            context,
          );
          const first = chat.served();
          yield* first.restarted([member]);
          yield* Effect.promise(() => scene.store.arrivals.claimed({ ...leftUnanswered, message: '1700.8' }));
          yield* first.stop();
          const second = chat.served();
          yield* second.restarted([member]);
          yield* second.arrived([member], aMention);
          yield* Effect.promise(() => logged);
          yield* second.stop();
        }),
      resolve,
    );

    expect([scene.fake.calls(), outcomeOf(await logged).annotations.outcome]).toEqual([
      ['answered', 'answered', 'typing', 'answered'],
      'answered',
    ]);
  });
});

function linesCounted(count: number) {
  const lines: string[] = [];
  const { promise: counted, resolve } = Promise.withResolvers<void>();
  const logged = (line: string) => {
    lines.push(line);
    if (lines.length === count) {
      resolve();
    }
  };
  return { lines, counted, logged };
}

describe('the chat beside the sockets, where Auto cannot show again that it is working', () => {
  it('logs it, and answers all the same', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Up.')] } });
    const connection = { ...scene.connection, service: typingThatFailsAfterTheFirst(scene.connection.service) };
    const models = answeredAfterAWait(scene.serving.models, scene.stepped);
    const { lines, counted, logged } = linesCounted(2);

    await inTestTime(
      (context) =>
        Effect.gen(function* () {
          const sockets = chatSocketsOf(
            { serving: { ...scene.serving, models }, connectionOf: () => Promise.resolve(connection) },
            context,
          ).served();
          yield* sockets.arrived([member], aMention);
          yield* Effect.promise(() => counted);
          yield* sockets.stop();
        }),
      logged,
    );

    expect([lines.map((line) => levelOf(line).level).toSorted(), scene.fake.said.at(-1)?.text]).toEqual([
      ['INFO', 'WARN'],
      'Up.',
    ]);
  });
});
