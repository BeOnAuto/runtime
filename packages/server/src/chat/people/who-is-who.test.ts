import { describe, expect, it } from 'vitest';

import { serviceFake } from '../../testing/chat/chat-fakes.ts';
import { knowingOver, theHash } from '../../testing/chat/chat-scenes.ts';
import { chatStoreInMemory } from '../../testing/chat/chat-store-in-memory.ts';
import { slackChatRenderingForTests as render } from '../../testing/chat/slack-chat-rendering.ts';
import type { SenderRead } from '../service/service-calls.ts';
import type { ChatStore } from '../store/chat-store.ts';
import { personWhoWrote, whoWrote, type Known } from './who-is-who.ts';

const member = { account: 'T1', member: 'U1' };

const where = { id: 'm1', conversation: 'c1', thread: undefined, sender: 'U1', kind: 'mention' };

const confirmed: SenderRead = { email: 'ada@example.com', verified: true, account: 'T1', active: true, name: 'Ada' };

interface Asked {
  readonly text: string;
  readonly sender?: SenderRead;
  readonly waiting?: boolean;
  readonly setUp?: (store: ChatStore) => Promise<void>;
  readonly accountName?: string;
}

async function knownAs({ text, sender, waiting = false, setUp, accountName }: Asked) {
  const { store } = chatStoreInMemory();
  await setUp?.(store);
  const knowing = knowingOver(store, { roles: ['ada'], verified: { 'ada@example.com': 'ada' } });
  const service = serviceFake(sender === undefined ? {} : { sender }).service;
  const requestWaits = () => Promise.resolve(waiting);
  const known = await whoWrote({ member, where, text, service, render, accountName, requestWaits }, knowing);
  return { known, store };
}

const linkedTo = (person: string) => (store: ChatStore) => store.links.linked({ ...member, person, linkedAt: 1 });

const startedFor = (startMember: string) => (store: ChatStore) =>
  store.links.started({ account: 'T1', member: startMember, secret: theHash.of('BCDFGH'), person: 'ada' });

function partsOf(known: Known): readonly string[] {
  if ('person' in known) {
    return ['person', known.person];
  }
  return 'told' in known
    ? ['told', known.told]
    : ['signIn', known.signIn.line, String(known.signIn.address.startsWith('https://runtime.example.com/'))];
}

describe('who wrote a message, known', () => {
  it.each([
    ['linked to a person who holds a role', { text: 'Hi', sender: confirmed, setUp: linkedTo('ada') }],
    ['recognised by an address both sides confirmed', { text: 'Hi', sender: confirmed }],
  ] as const)('is the person where they are %s', async (_, asked) => {
    expect(partsOf((await knownAs(asked)).known)).toEqual(['person', 'ada']);
  });

  it.each([
    [
      'linked to a person who holds no role, and unconfirmed',
      { text: 'Hi', sender: { ...confirmed, verified: false }, setUp: linkedTo('eve') },
    ],
    ['of another account', { text: 'Hi', sender: { ...confirmed, account: 'T2' } }],
    ['inactive', { text: 'Hi', sender: { ...confirmed, active: false } }],
    ['unread at the service', { text: 'Hi' }],
  ] as const)('gets a link to sign in where they are %s', async (_, asked) => {
    expect(partsOf((await knownAs(asked)).known)[0]).toBe('signIn');
  });
});

describe('who wrote a message, given a link to sign in', () => {
  it('is told the line for a confirmed address no member has, or for every other case with the line for a waiting request', async () => {
    const unmatched = await knownAs({ text: 'Hi', sender: { ...confirmed, email: 'eve@example.com' } });
    const waiting = await knownAs({ text: 'Hi', waiting: true });

    expect([partsOf(unmatched.known), partsOf(waiting.known)]).toEqual([
      ['signIn', render.words.notRecognised, 'true'],
      ['signIn', `${render.words.signInToUse} ${render.words.toAnswerARequest}`, 'true'],
    ]);
  });
});

describe('who wrote a message, sending a code', () => {
  it.each([
    [
      'their own code',
      { text: 'BCDFGH', setUp: startedFor('U1'), accountName: 'Acme' },
      render.words.connected({ account: 'Acme', person: 'name of ada' }),
      'ada',
    ],
    [
      'their own code, through a connection whose account the service did not name',
      { text: 'BCDFGH', setUp: startedFor('U1') },
      render.words.connected({ account: render.service, person: 'name of ada' }),
      'ada',
    ],
    [
      'a code made for another member',
      { text: 'BCDFGH', setUp: startedFor('U2') },
      render.words.anotherMember,
      undefined,
    ],
    ['a wrong code', { text: 'XXXXXX', setUp: startedFor('U1') }, render.words.wrongCode, undefined],
  ] as const)('is told the outcome of %s', async (_, asked, words, linked) => {
    const { known, store } = await knownAs(asked);

    expect([partsOf(known), (await store.links.linkOf(member))?.person]).toEqual([['told', words], linked]);
  });

  it('is a person or none, with no code and no link, for a reply that did not name Auto', async () => {
    const { store } = chatStoreInMemory();
    const knowing = knowingOver(store, { verified: { 'ada@example.com': 'ada' } });

    expect([
      await personWhoWrote({ member, where, service: serviceFake({ sender: confirmed }).service }, knowing),
      await personWhoWrote({ member, where, service: serviceFake().service }, knowing),
      await store.links.startOf(member),
    ]).toEqual(['ada', undefined, undefined]);
  });
});
