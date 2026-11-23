import { asking, neverSettled, resultOf, type Answering } from '@on.auto/chat/testing';
import { describe, expect, it } from 'vitest';

import {
  directoryFake,
  modelsFake,
  serviceFake,
  type ModelsScript,
  type ServiceScript,
} from '../../testing/chat/chat-fakes.ts';
import { chatStoreInMemory } from '../../testing/chat/chat-store-in-memory.ts';
import { slackChatRenderingForTests as render } from '../../testing/chat/slack-chat-rendering.ts';
import { turnTaken, type TurnParts } from './chat-turn.ts';
import { boundsFor } from './turn-model.ts';

const where = { id: '1700.2', conversation: 'C1', thread: '1700.1', sender: 'U1', kind: 'mention' };

interface Turning {
  readonly service?: ServiceScript;
  readonly models?: ModelsScript;
  readonly roles?: readonly string[];
  readonly aborted?: boolean;
  readonly directory?: TurnParts['directory'];
  readonly waits?: TurnParts['waits'];
  readonly now?: TurnParts['now'];
}

function modelOf(answers: Turning['models'], aborted: boolean, stopping: AbortController): TurnParts['chosen'] {
  const { models } = modelsFake(answers);
  const stopped = () => {
    stopping.abort();
    return neverSettled<never>();
  };
  return {
    model: { name: 'provider/model', generate: aborted ? stopped : models.generate('provider/model') },
    ...boundsFor({}),
  };
}

function partsOf(
  { models, roles = ['ada'], aborted = false, directory, waits, now }: Turning,
  service: TurnParts['service'],
): TurnParts {
  const stopping = new AbortController();
  return {
    service,
    render,
    chosen: modelOf(models, aborted, stopping),
    directory: directory ?? directoryFake().directory,
    directoryUrl: 'https://runtime.example.com/directory',
    holdsARole: (person) => Promise.resolve(roles.includes(person)),
    now: now ?? (() => 1_000),
    waits: waits ?? (() => ({ elapsed: neverSettled(), stop: () => {} })),
    signal: stopping.signal,
    notShownHere: { has: () => false, add: () => {} },
    renewalFailed: () => {},
  };
}

async function turned(turning: Turning = {}) {
  const { store } = chatStoreInMemory();
  const fake = serviceFake(turning.service);
  const place = { connection: 'c', account: 'T1', conversation: 'C1', thread: '1700.1' };
  const lease = await store.conversations.leaseTaken(await store.conversations.started(place));
  if (!('leased' in lease)) {
    throw new Error('the conversation was not leased');
  }
  const asked = {
    person: 'ada',
    where,
    app: 'U0AUTO',
    text: 'How are the sales?',
    autoNotNamed: false,
    leased: lease.leased,
    answering: () => {},
  };
  const settled = await turnTaken(asked, partsOf(turning, fake.service));
  const kept = await lease.leased.memory.newest(9);
  return { settled, posted: fake.said.filter(({ call }) => call === 'answered').map(({ text }) => text), kept };
}

const stalled: TurnParts['directory'] = { asking: (_caller, _context, use) => use(() => neverSettled()) };

const steps = (...calls: readonly number[]): readonly Answering[] =>
  calls.map((each) => asking({ id: `call-${each}`, tool: 'list_playbooks', input: {} }));

describe('a turn of a conversation', () => {
  it("reads its thread's earlier messages on its first turn, and keeps them before what was said", async () => {
    const thread = [
      { id: '1700.1', sender: 'U2', text: 'Who owns this?' },
      { id: '1700.2', sender: 'U1', text: 'How are the sales?' },
    ];
    const { settled, kept } = await turned({ service: { thread }, models: { answers: [resultOf('Up.')] } });

    expect([settled, kept.map(({ author }) => author)]).toEqual(['answered', ['context', 'person', 'assistant']]);
  });

  it.each([
    [
      'the model answered nothing after a step',
      { answers: [...steps(1), resultOf('')] },
      ['ada'],
      `${render.words.notAnswered} ${render.words.stepsAlreadyDone}`,
    ],
    ['the role of the person no longer lets them act', { answers: steps(1) }, [], render.words.notAdmitted],
    ['the model failed', { answers: [] }, ['ada'], render.words.notAnswered],
  ] as const)('says so where %s, and keeps the person’s message alone', async (_, models, roles, words) => {
    const { settled, posted, kept } = await turned({ models, roles });

    expect([settled, posted, kept.map(({ author }) => author)]).toEqual(['refused', [words], ['person']]);
  });
});

describe('a turn of a conversation that ends early', () => {
  it('says the turn took more steps than one message allows where its time ran out after a step', async () => {
    const clock = { at: 0 };
    const now = () => {
      clock.at += 400_000;
      return clock.at;
    };
    const { settled, posted } = await turned({ models: { answers: [...steps(1), resultOf('Up.')] }, now });

    expect([settled, posted.map((text) => text?.startsWith(render.words.boundReached))]).toEqual(['refused', [true]]);
  });

  it('says it did not answer where the server stops during the turn, and keeps nothing of it', async () => {
    const { settled, posted, kept } = await turned({ aborted: true, models: { answers: [resultOf('Up.')] } });

    expect([settled, posted, kept]).toEqual(['failed', [render.words.notAnswered], []]);
  });

  it.each([
    ['refuses to list them', { directory: directoryFake(true).directory }],
    [
      'does not list them in time',
      {
        directory: stalled,
        waits: () => ({ elapsed: Promise.resolve(), stop: () => {} }),
      },
    ],
  ] as const)('says it did not answer where the directory of tools %s', async (_, turning) => {
    const { settled, posted } = await turned({ ...turning, models: { answers: [resultOf('Up.')] } });

    expect([settled, posted]).toEqual(['refused', [render.words.notAnswered]]);
  });
});
