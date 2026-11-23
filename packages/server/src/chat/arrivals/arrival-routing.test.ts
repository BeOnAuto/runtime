import { resultOf } from '@on.auto/chat/testing';
import type { ChatMessage } from '@on.auto/providers';
import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatScene, heldAt, keptIn, rememberedIn, type ChatScene, type Place } from '../../testing/chat/chat-scenes.ts';
import { claimOf, routeOf } from './arrival-routing.ts';
import { arrivalTaken, type Outcome } from './chat-arrivals.ts';

const aMention: ChatMessage = {
  kind: 'mention',
  id: '1700.2',
  conversation: 'C1',
  sender: 'U1',
  account: 'T1',
  text: '<@U0AUTO> How are the sales?',
  shared: false,
  app: 'U0AUTO',
};

const inAThread = { thread: '1700.1' } as const;

const ofNoAccount: ChatMessage = Struct.omit(aMention, ['account']);

describe('where a message a person wrote goes', () => {
  it.each([
    ['a mention', aMention, {}, 'person'],
    ['a direct message', { ...aMention, kind: 'direct_message' }, {}, 'person'],
    ['a mention in a thread under no request', { ...aMention, ...inAThread }, {}, 'person'],
    ['a mention as the first message of its thread', { ...aMention, thread: '1700.2' }, { sentAs: true }, 'person'],
    ['a reply under a request of a playbook, named or not', { ...aMention, ...inAThread }, { sentAs: true }, 'passed'],
    ['a message of another account', { ...aMention, account: 'T2' }, {}, 'passed'],
    ['a message of no account', ofNoAccount, {}, 'passed'],
    ['a message of blank words', { ...aMention, text: '  ' }, {}, 'passed'],
    [
      'a reply that does not name Auto, in a thread Auto holds no conversation in',
      { ...aMention, kind: 'ambient', ...inAThread },
      {},
      'passed',
    ],
  ] as const)('sends %s to: %s', async (_, message, script, routed) => {
    const { connection, store } = chatScene(script);

    expect(await routeOf(message, connection, store)).toBe(routed);
  });

  it('takes a reply that does not name Auto only where its writer already spoke to Auto in that thread', async () => {
    const { connection, store } = chatScene();
    const place = { connection: 'connection-1', account: 'T1', conversation: 'C1', thread: '1700.1' };
    await rememberedIn(store, place, [{ author: 'person', sender: 'U1', text: 'Hi' }]);
    await rememberedIn(store, { ...place, thread: undefined }, [{ author: 'person', sender: 'U1', text: 'Hi' }]);
    const ambient = { ...aMention, kind: 'ambient' as const, ...inAThread };

    expect([
      await routeOf(ambient, connection, store),
      await routeOf({ ...ambient, sender: 'U2' }, connection, store),
      await routeOf(Struct.omit(ambient, ['thread']), connection, store),
      await routeOf({ ...ambient, thread: ambient.id }, connection, store),
    ]).toEqual(['ambient', 'passed', 'passed', 'passed']);
  });
});

describe('the claim on a message', () => {
  const arrival = { connection: 'connection-1', account: 'T1', conversation: 'C1', message: '1700.2', kind: 'mention' };

  it('runs the first taker alone, and lets a mention outrank a reply passed over but not one being taken', async () => {
    const { store } = chatScene();
    const first = await claimOf(arrival, store);
    const again = await claimOf(arrival, store);
    const ambient = { ...arrival, message: '1700.3', kind: 'ambient' };
    await claimOf(ambient, store);
    const whileTaken = await claimOf({ ...ambient, kind: 'mention' }, store);
    const passed = { ...arrival, message: '1700.4', kind: 'ambient' };
    await claimOf(passed, store);
    await store.arrivals.passed(passed);

    expect([
      first,
      again,
      whileTaken,
      await claimOf({ ...passed, kind: 'mention' }, store),
      await claimOf(ambient, store),
    ]).toEqual(['run', 'dropped', 'dropped', 'run', 'dropped']);
  });
});

const ada = { email: 'ada@example.com', verified: true, account: 'T1', active: true, name: 'Ada' };

const atTheTop: Place = { connection: 'connection-1', account: 'T1', conversation: 'C1', thread: undefined };

const lunch: ChatMessage = { ...aMention, kind: 'ambient', id: '1700.4', text: 'lunch?' };

const inAutosThread: ChatMessage = { ...aMention, kind: 'ambient', id: '1700.5', thread: '1700.2', text: 'and May?' };

const bobsMention: ChatMessage = { ...aMention, id: '1700.3', sender: 'U2' };

const aDirectMessage: ChatMessage = { ...aMention, kind: 'direct_message', text: 'How are the sales?' };

type Delivered = Outcome | 'routed past';

async function deliveredOnce(scene: ChatScene, message: ChatMessage): Promise<Delivered> {
  const { connection, store } = scene;
  if ((await routeOf(message, connection, store)) === 'passed') {
    return 'routed past';
  }
  const arrival = {
    connection: 'connection-1',
    account: 'T1',
    conversation: 'C1',
    message: message.id,
    kind: message.kind,
  };
  await claimOf(arrival, store);
  return arrivalTaken({ message, connection, arrival }, scene.serving);
}

async function deliveredIn(scene: ChatScene, messages: readonly ChatMessage[]): Promise<readonly Delivered[]> {
  const [message, ...rest] = messages;
  return message === undefined ? [] : [await deliveredOnce(scene, message), ...(await deliveredIn(scene, rest))];
}

interface Deliveries {
  readonly messages: readonly ChatMessage[];
  readonly answers: readonly string[];
  readonly outcomes: readonly Delivered[];
  readonly kept: readonly (readonly [string | undefined, number])[];
}

const deliveries: readonly (readonly [string, Deliveries])[] = [
  [
    'a mention at the top of a channel, in the thread Auto answers it in',
    { messages: [aMention], answers: ['Up.'], outcomes: ['answered'], kept: [['1700.2', 2]] },
  ],
  [
    'none, for a message at the top of the channel after it that does not name Auto, passed over unchecked',
    { messages: [aMention, lunch], answers: ['Up.'], outcomes: ['answered', 'routed past'], kept: [['1700.2', 2]] },
  ],
  [
    'a reply that does not name Auto, in the thread Auto opened under the mention',
    {
      messages: [aMention, inAutosThread],
      answers: ['Up.', 'yes', 'Down.'],
      outcomes: ['answered', 'answered'],
      kept: [['1700.2', 4]],
    },
  ],
  [
    'one of two, for the mentions of two people at the top of one channel, each with a lease of its own',
    {
      messages: [aMention, bobsMention],
      answers: ['Up.', 'Down.'],
      outcomes: ['answered', 'answered'],
      kept: [
        ['1700.2', 2],
        ['1700.3', 2],
      ],
    },
  ],
  [
    'the direct message it was written in, outside a thread, answered in that conversation',
    {
      messages: [aDirectMessage, { ...aDirectMessage, id: '1700.3' }],
      answers: ['Up.', 'Down.'],
      outcomes: ['answered', 'answered'],
      kept: [[undefined, 4]],
    },
  ],
];

describe('the conversation a message a person wrote is part of', () => {
  it.each(deliveries)('is %s', async (_, { messages, answers, outcomes, kept }) => {
    const scene = chatScene({
      service: { sender: ada },
      verified: { 'ada@example.com': 'ada' },
      models: { answers: answers.map((answer) => resultOf(answer)) },
    });
    const delivered = await deliveredIn(scene, messages);
    const places: readonly Place[] = kept.map(([thread]) => ({ ...atTheTop, thread }));
    const remembered = await Promise.all(places.map(async (place) => (await keptIn(scene.store, place)).length));

    expect([delivered, scene.models.requests.length, remembered]).toEqual([
      outcomes,
      answers.length,
      kept.map(([, rows]) => rows),
    ]);
    await Promise.all(places.map((place) => heldAt(scene.store, place)));
  });
});
