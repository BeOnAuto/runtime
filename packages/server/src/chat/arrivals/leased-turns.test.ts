import { resultOf } from '@on.auto/chat/testing';
import type { ChatMessage } from '@on.auto/providers';
import { describe, expect, it, vi } from 'vitest';

import { answeredAfterAWait, typingThatFailsAfterTheFirst } from '../../testing/chat/chat-fakes.ts';
import { chatScene, rememberedIn, type ChatScene } from '../../testing/chat/chat-scenes.ts';
import { slackChatRenderingForTests as render } from '../../testing/chat/slack-chat-rendering.ts';
import type { ServingNow } from './arrival-parts.ts';
import { arrivalTaken } from './chat-arrivals.ts';

const recognised = {
  service: { sender: { email: 'ada@example.com', verified: true, account: 'T1', active: true, name: 'Ada' } },
  verified: { 'ada@example.com': 'ada' },
} as const;

const aMention: ChatMessage = {
  kind: 'mention',
  id: '1700.6',
  conversation: 'C1',
  thread: '1700.1',
  sender: 'U1',
  account: 'T1',
  text: '<@U0AUTO> How are the sales?',
  shared: false,
  app: 'U0AUTO',
};

const aReply: ChatMessage = { ...aMention, kind: 'ambient', id: '1700.2', text: 'and last week?' };

interface WhileHeld {
  readonly serving: ServingNow;
  readonly atTheCall: Promise<void>;
  readonly holderSeen: Promise<void>;
  readonly letGo: () => void;
}

function heldAtTheFirstCall(scene: ChatScene): WhileHeld {
  const { promise: atTheCall, resolve: called } = Promise.withResolvers<void>();
  const { promise: gate, resolve: letGo } = Promise.withResolvers<void>();
  const { promise: holderSeen, resolve: seen } = Promise.withResolvers<void>();
  const generate = scene.serving.models.generate('provider/model');
  const made = { calls: 0 };
  const held: typeof generate = async (request, signal) => {
    made.calls += 1;
    if (made.calls === 1) {
      called();
      await gate;
    }
    return generate(request, signal);
  };
  const { holders } = scene.serving;
  const watched: ServingNow['holders'] = {
    ...holders,
    heldHere: (conversation) => {
      const here = holders.heldHere(conversation);
      if (here !== undefined) {
        seen();
      }
      return here;
    },
  };
  const models = { ...scene.serving.models, generate: () => held };
  return { serving: { ...scene.serving, models, holders: watched }, atTheCall, holderSeen, letGo };
}

async function takenIn(scene: ChatScene, message: ChatMessage, serving: ServingNow) {
  const arrival = {
    connection: 'connection-1',
    account: 'T1',
    conversation: 'C1',
    message: message.id,
    kind: message.kind,
  };
  await scene.store.arrivals.claimed(arrival);
  return arrivalTaken({ message, connection: scene.connection, arrival }, serving);
}

interface Meanwhile {
  readonly first: ChatMessage;
  readonly second: ChatMessage;
  readonly answers: readonly string[];
  readonly outcomes: readonly [string, string];
  readonly stillWorking: boolean;
}

const meanwhile: readonly (readonly [string, Meanwhile])[] = [
  [
    'a mention, while a reply that did not name Auto is checked, is answered once the check is over',
    {
      first: aReply,
      second: aMention,
      answers: ['no', 'Down.'],
      outcomes: ['passed', 'answered'],
      stillWorking: false,
    },
  ],
  [
    'a mention, while the check finds the reply meant for Auto, is told Auto is still working',
    { first: aReply, second: aMention, answers: ['yes', 'Down.'], outcomes: ['answered', 'busy'], stillWorking: true },
  ],
  [
    'a mention, while the turn of another mention runs, is told Auto is still working',
    {
      first: { ...aMention, id: '1700.5' },
      second: aMention,
      answers: ['Up.'],
      outcomes: ['answered', 'busy'],
      stillWorking: true,
    },
  ],
  [
    'a reply that did not name Auto, while another is checked, is passed over unchecked',
    {
      first: aReply,
      second: { ...aReply, id: '1700.7' },
      answers: ['no'],
      outcomes: ['passed', 'passed'],
      stillWorking: false,
    },
  ],
];

describe('a message written while the first model call of a turn of its conversation runs', () => {
  it.each(meanwhile)('%s', async (_, { first, second, answers, outcomes, stillWorking }) => {
    const scene = chatScene({ ...recognised, models: { answers: answers.map((answer) => resultOf(answer)) } });
    await rememberedIn(
      scene.store,
      { connection: 'connection-1', account: 'T1', conversation: 'C1', thread: '1700.1' },
      [
        { author: 'person', sender: 'U1', text: 'How are the sales?' },
        { author: 'assistant', sender: undefined, text: 'Up.' },
      ],
    );
    const running = heldAtTheFirstCall(scene);
    const firstTaken = takenIn(scene, first, running.serving);
    await running.atTheCall;
    const secondTaken = takenIn(scene, second, running.serving);
    await running.holderSeen;
    running.letGo();
    const taken = [await firstTaken, await secondTaken];

    expect([
      taken,
      scene.fake.said.some(({ text }) => text === render.words.stillWorking),
      scene.models.requests.length,
    ]).toEqual([outcomes, stillWorking, answers.length]);
  });
});

describe('a mention whose lease cannot be taken', () => {
  it('leaves the conversation free, so the next mention in it is answered and not told Auto is still working', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Up.')] } });
    const { conversations } = scene.store;
    const refused = new Error('the store did not answer');
    const leaseTaken = vi
      .fn<typeof conversations.leaseTaken>()
      .mockRejectedValueOnce(refused)
      .mockImplementation((conversation) => conversations.leaseTaken(conversation));
    const serving = { ...scene.serving, store: { ...scene.store, conversations: { ...conversations, leaseTaken } } };

    const first = await takenIn(scene, { ...aMention, id: '1700.5' }, serving).catch((error: unknown) => error);
    const second = await takenIn(scene, aMention, serving);

    expect([
      first,
      second,
      scene.fake.said.some(({ text }) => text === render.words.stillWorking),
      scene.models.requests.length,
    ]).toEqual([refused, 'answered', false, 1]);
  });
});

describe('a turn whose working status cannot be shown again', () => {
  it('is answered all the same, and hands the failure to the serving to be logged', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Up.')] } });
    const service = typingThatFailsAfterTheFirst(scene.connection.service);
    const models = answeredAfterAWait(scene.serving.models, scene.stepped);
    const arrival = {
      connection: 'connection-1',
      account: 'T1',
      conversation: 'C1',
      message: aMention.id,
      kind: 'mention',
    };
    await scene.store.arrivals.claimed(arrival);
    const taken = await arrivalTaken(
      { message: aMention, connection: { ...scene.connection, service }, arrival },
      { ...scene.serving, models },
    );

    expect([taken, scene.fake.said.at(-1)?.text, scene.renewalsFailed.length]).toEqual(['answered', 'Up.', 1]);
  });
});
