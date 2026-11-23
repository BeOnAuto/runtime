import { resultOf } from '@on.auto/chat/testing';
import type { ChatMessage } from '@on.auto/providers';
import { describe, expect, it } from 'vitest';

import {
  chatScene,
  heldAt,
  keptIn,
  rememberedIn,
  theHash,
  type ChatScene,
  type SceneScript,
} from '../../testing/chat/chat-scenes.ts';
import { slackChatRenderingForTests as render } from '../../testing/chat/slack-chat-rendering.ts';
import type { Arrival } from '../tables/chat-rows.ts';
import { arrivalTaken, restartTold } from './chat-arrivals.ts';

const ada = { email: 'ada@example.com', verified: true, account: 'T1', active: true, name: 'Ada' };

const recognised: SceneScript = { service: { sender: ada }, verified: { 'ada@example.com': 'ada' } };

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

const ambient: ChatMessage = { ...aMention, kind: 'ambient', thread: '1700.1', text: 'and last week?' };

const topLevel = { connection: 'connection-1', account: 'T1', conversation: 'C1', thread: undefined };

const inTheThread = { ...topLevel, thread: '1700.1' };

const ofTheMention = { ...topLevel, thread: aMention.id };

type Scene = ChatScene;

function arrivalOf(message: ChatMessage): Arrival {
  return {
    connection: 'connection-1',
    account: 'T1',
    conversation: message.conversation,
    message: message.id,
    kind: message.kind,
  };
}

async function takenIn(scene: Scene, message: ChatMessage = aMention, serving = scene.serving) {
  const arrival = arrivalOf(message);
  await scene.store.arrivals.claimed(arrival);
  return arrivalTaken({ message, connection: scene.connection, arrival }, serving);
}

const saidIn = (scene: Scene) => scene.fake.said.map(({ call, text }) => [call, text]);

async function spokenIn(scene: Scene): Promise<void> {
  await rememberedIn(scene.store, inTheThread, [
    { author: 'person', sender: 'U1', text: 'How are the sales?' },
    { author: 'assistant', sender: undefined, text: 'Up.' },
  ]);
}

describe('a message a person wrote to Auto, answered by a command or refused', () => {
  it.each([
    [
      'in a channel shared with another organization',
      { ...aMention, shared: true },
      'shared',
      [['alone', render.words.shared]],
    ],
    ['asking for help', { ...aMention, text: '<@U0AUTO> HELP' }, 'help', [['answered', render.words.help]]],
    [
      'asking to disconnect, with nothing connected',
      { ...aMention, text: 'disconnect' },
      'not_connected',
      [['answered', render.words.notConnected]],
    ],
  ] as const)('is answered %s', async (_, message, outcome, said) => {
    const scene = chatScene();

    expect([await takenIn(scene, message), saidIn(scene)]).toEqual([outcome, said]);
  });

  it('disconnects a member linked to a person, and says so', async () => {
    const scene = chatScene();
    await scene.store.links.linked({ account: 'T1', member: 'U1', person: 'ada', linkedAt: 1 });

    expect([
      await takenIn(scene, { ...aMention, text: 'disconnect' }),
      await scene.store.links.linkOf({ account: 'T1', member: 'U1' }),
    ]).toEqual(['disconnected', undefined]);
  });

  it.each([
    ['no model is chosen', { ...recognised, model: null }],
    ['the chosen model is no longer offered', { ...recognised, models: { refusal: 'gone' } }],
  ] as const)('tells a member alone that Auto cannot answer where %s', async (_, script) => {
    const scene = chatScene(script);

    expect([await takenIn(scene), saidIn(scene)]).toEqual(['no_model', [['alone', render.words.noModel]]]);
  });
});

describe('a message from someone Auto does not recognize', () => {
  it('gives them a button to sign in, in a line only they see, or in the direct message itself', async () => {
    const inAChannel = chatScene();
    const direct = chatScene();
    const outcomes = [await takenIn(inAChannel), await takenIn(direct, { ...aMention, kind: 'direct_message' })];
    const laidOut = [inAChannel, direct].map((scene) => JSON.stringify(scene.fake.said[0]?.rendered));

    expect([outcomes, saidIn(inAChannel)[0]?.[0], saidIn(direct)[0]?.[0]]).toEqual([
      ['sign_in', 'sign_in'],
      'alone',
      'answered',
    ]);
    expect(laidOut.map((each) => each.includes('"url":"https://runtime.example.com/'))).toEqual([true, true]);
  });

  it('tells whoever sends their code that it connected them', async () => {
    const scene = chatScene();
    await scene.store.links.started({ account: 'T1', member: 'U1', secret: theHash.of('BCDFGH'), person: 'ada' });

    expect(await takenIn(scene, { ...aMention, text: '<@U0AUTO> bcdfgh' })).toBe('told');
  });
});

describe('a message from a member', () => {
  it('is answered in the thread as the person Auto recognizes, and what was said is remembered', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Sales are up.')] } });

    expect([await takenIn(scene), saidIn(scene), scene.callers]).toEqual([
      'answered',
      [
        ['typing', undefined],
        ['answered', 'Sales are up.'],
      ],
      ['person:ada'],
    ]);
    expect(await keptIn(scene.store, ofTheMention)).toEqual([
      ['person', 'How are the sales?'],
      ['assistant', 'Sales are up.'],
    ]);
    expect(await scene.store.arrivals.unsettled()).toEqual([]);
  });

  it('is shown that Auto is working by a message turned into the answer, where the service shows no status there', async () => {
    const scene = chatScene({
      ...recognised,
      service: { ...recognised.service, typing: 'refused', sent: '1700.3' },
      models: { answers: [resultOf('Sales are up.')] },
    });

    expect([await takenIn(scene), scene.fake.calls()]).toEqual(['answered', ['typing', 'answered', 'replaced']]);
  });

  it('is told Auto is still working where a turn of the conversation runs', async () => {
    const scene = chatScene(recognised);
    await heldAt(scene.store, ofTheMention);

    expect([await takenIn(scene), saidIn(scene)]).toEqual(['busy', [['answered', render.words.stillWorking]]]);
    await expect(heldAt(scene.store, ofTheMention)).rejects.toThrow('The conversation is leased to another turn');
  });
});

describe('a reply that did not name Auto, in a thread where its writer spoke to Auto', () => {
  it.each([
    ['from someone it does not recognize', { script: {}, message: ambient, outcome: 'passed', calls: [] }],
    [
      'in a shared channel',
      { script: recognised, message: { ...ambient, shared: true }, outcome: 'passed', calls: [] },
    ],
    [
      'judged not meant for Auto',
      {
        script: { ...recognised, models: { answers: [resultOf('no')] } },
        message: ambient,
        outcome: 'passed',
        calls: [],
      },
    ],
    [
      'judged meant for Auto',
      {
        script: { ...recognised, models: { answers: [resultOf('yes'), resultOf('Down.')] } },
        message: ambient,
        outcome: 'answered',
        calls: ['typing', 'answered'],
      },
    ],
  ] as const)('is %s', async (_, { script, message, outcome, calls }) => {
    const scene = chatScene(script);
    await spokenIn(scene);

    expect([await takenIn(scene, message), scene.fake.calls()]).toEqual([outcome, calls]);
  });
});

describe('a reply that did not name Auto, outranked by a mention of the same message', () => {
  it('is answered as the mention where the mention came first', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('Down.')] } });
    await spokenIn(scene);
    await scene.store.arrivals.claimed(arrivalOf(ambient));
    await scene.store.arrivals.outranked({ ...arrivalOf(ambient), kind: 'mention' }, 'ambient');

    expect([
      await arrivalTaken(
        { message: ambient, connection: scene.connection, arrival: arrivalOf(ambient) },
        scene.serving,
      ),
      scene.models.requests.length,
    ]).toEqual(['answered', 1]);
  });

  it('is answered as the mention where the mention came while the check ran', async () => {
    const scene = chatScene({ ...recognised, models: { answers: [resultOf('no'), resultOf('Down.')] } });
    await spokenIn(scene);
    const generate = scene.serving.models.generate('provider/model');
    const outranking: typeof generate = async (request, signal) => {
      await scene.store.arrivals.outranked({ ...arrivalOf(ambient), kind: 'mention' }, 'ambient');
      return generate(request, signal);
    };
    const models = { ...scene.serving.models, generate: () => outranking };

    expect(await takenIn(scene, ambient, { ...scene.serving, models })).toBe('answered');
  });
});

describe('a message a restart left unanswered', () => {
  const arrival = arrivalOf(aMention);

  it('is told once that Auto did not answer, and settled; a reply not naming Auto, or one of a connection gone, is settled alone', async () => {
    const scene = chatScene();
    const quiet: Arrival = { ...arrival, message: '1700.3', kind: 'ambient' };
    const gone: Arrival = { ...arrival, message: '1700.4' };
    await Promise.all([arrival, quiet, gone].map((each) => scene.store.arrivals.claimed(each)));
    await restartTold(arrival, scene.connection, scene.store);
    await restartTold(quiet, scene.connection, scene.store);
    await restartTold(gone, undefined, scene.store);

    expect([saidIn(scene), await scene.store.arrivals.unsettled()]).toEqual([
      [['answered', render.words.notAnswered]],
      [],
    ]);
  });
});
