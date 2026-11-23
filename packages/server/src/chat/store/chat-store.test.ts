import type { Remembered } from '@on.auto/chat';
import { describe, expect, it } from 'vitest';

import { chatRowsInMemory } from '../../testing/chat/chat-rows-in-memory.ts';
import { chatStoreInMemory } from '../../testing/chat/chat-store-in-memory.ts';
import type { ChatRows, SealedRow } from '../tables/chat-rows.ts';
import { TURN_LEASE_MS, type ChatStore, type LeaseTaken } from './chat-store.ts';
import { ConversationKeyMissing } from './conversation-key.ts';
import { ConversationLeaseLost, type LeasedConversation } from './leased-memory.ts';
import { SealedTextRefused } from './sealed-texts.ts';

const place = { connection: 'connection-1', account: 'account-1', conversation: 'conversation-1', thread: 'thread-1' };

const asked: Remembered = { author: 'person', sender: 'member-1', text: 'Which workflows ran today?' };

const answered: Remembered = { author: 'assistant', sender: undefined, text: 'Two ran today, and both finished.' };

function leasedIn(taken: LeaseTaken): LeasedConversation {
  if (!('leased' in taken)) {
    throw new Error('A turn holds the conversation');
  }
  return taken.leased;
}

function unseenAtItsFirstLook(rows: ChatRows): ChatRows {
  const looked = { first: true };
  return {
    ...rows,
    conversations: {
      ...rows.conversations,
      found: async (looking) => {
        const seen = looked.first ? undefined : await rows.conversations.found(looking);
        looked.first = false;
        return seen;
      },
    },
  };
}

async function aTurnOf(store: ChatStore): Promise<LeasedConversation> {
  return leasedIn(await store.conversations.leaseTaken(await store.conversations.started(place)));
}

describe('the arrivals of the chat store', () => {
  it('take the first arrival of a message and tell a second it lost, and list it until it is settled', async () => {
    const { store } = chatStoreInMemory();
    const arrival = { ...place, message: 'message-1', kind: 'mention' };

    const claimed = [await store.arrivals.claimed(arrival), await store.arrivals.claimed(arrival)];
    const unsettled = await store.arrivals.unsettled();
    await store.arrivals.settled(arrival);

    expect([claimed, unsettled.length, await store.arrivals.unsettled()]).toEqual([[true, false], 1, []]);
  });

  it('let a mention outrank a reply passed over, and say whether a member spoke in a conversation', async () => {
    const { store } = chatStoreInMemory();
    const ambient = { ...place, message: 'message-1', kind: 'ambient' };
    await store.arrivals.claimed(ambient);
    const passed = await store.arrivals.passed(ambient);
    const outranked = await store.arrivals.outranked({ ...ambient, kind: 'mention' }, 'ambient');
    const conversation = await store.conversations.started(place);

    expect([
      passed,
      outranked,
      await store.arrivals.kindOf(ambient),
      await store.conversations.spokenIn(conversation, 'member-1'),
    ]).toEqual([true, 'taken', 'mention', false]);
  });
});

describe('the lease on a conversation', () => {
  it.each([
    ['held', 5, false],
    ['passed at that moment', 10, true],
    ['passed', 11, true],
  ])('goes to the next turn where it has %s, by the clock it is handed: %s', async (_case, at, taken) => {
    const { store, clock } = chatStoreInMemory(10);
    const conversation = await store.conversations.started(place);
    await store.conversations.leaseTaken(conversation);

    clock.moveTo(at);

    expect('leased' in (await store.conversations.leaseTaken(conversation))).toBe(taken);
  });

  it('ships at 12 minutes, above a turn’s 10', async () => {
    const { store, clock } = chatStoreInMemory();
    const conversation = await store.conversations.started(place);
    await store.conversations.leaseTaken(conversation);

    clock.moveTo(TURN_LEASE_MS - 1);
    const held = await store.conversations.leaseTaken(conversation);
    clock.moveTo(TURN_LEASE_MS);

    expect([TURN_LEASE_MS, held, 'leased' in (await store.conversations.leaseTaken(conversation))]).toEqual([
      720_000,
      { running: true },
      true,
    ]);
  });

  it('goes to the next turn at once once the turn that held it lets it go', async () => {
    const { store } = chatStoreInMemory();
    const turn = await aTurnOf(store);

    await turn.released();

    expect('leased' in (await store.conversations.leaseTaken(await store.conversations.started(place)))).toBe(true);
  });
});

describe('a conversation of the chat store', () => {
  it('is started once for a place, with a key of its own kept in the secret store', async () => {
    const { store, keys } = chatStoreInMemory();

    const [first, again] = [await store.conversations.started(place), await store.conversations.started(place)];

    expect(again).toEqual(first);
    expect(await store.conversations.found(place)).toEqual(first);
    expect(await keys.read(first.keyId)).toMatch(/^[\w+/]{43}=$/u);
  });

  it('is the one another server started first, the key made for it here forgotten', async () => {
    const rows = chatRowsInMemory();
    const other = { ...place, id: 'started-elsewhere', keyId: 'key-elsewhere' };
    await rows.conversations.made(other, 0);
    const { store, keys } = chatStoreInMemory(undefined, unseenAtItsFirstLook(rows));

    expect(await store.conversations.started(place)).toEqual(other);
    expect(keys.forgotten()).toBe(1);
  });
});

describe('what a conversation remembers', () => {
  it('is kept sealed, and given back in its order, under one read of its key for a turn', async () => {
    const { store, rows, keys } = chatStoreInMemory();
    const empty = await aTurnOf(store);
    const nothing = await empty.memory.newest(10);
    await empty.memory.appended([]);
    const readsOfAnEmptyTurn = keys.reads();
    await empty.memory.appended([asked, answered]);
    await empty.released();

    const turn = await aTurnOf(store);
    const remembered = await turn.memory.newest(10);
    await turn.memory.appended([{ ...asked, text: 'And yesterday?' }]);

    expect([nothing, readsOfAnEmptyTurn, keys.reads()]).toEqual([[], 0, 2]);
    expect(remembered).toEqual([
      { ...asked, sequence: 1 },
      { ...answered, sequence: 2 },
    ]);
    const sealed = await rows.messages.newest((await store.conversations.started(place)).id, 10);
    expect(sealed.map(({ sealed: text }) => text.includes('today'))).toEqual([false, false, false]);
  });

  it.each<readonly [string, Partial<SealedRow>]>([
    ['moved to another row', { sequence: 2 }],
    ['relabelled with another author', { author: 'overheard' }],
    ['relabelled with another sender', { sender: 'member-2' }],
    ['relabelled with no sender', { sender: undefined }],
  ])('refuses a sealed text %s', async (_case, changed) => {
    const { store, rows } = chatStoreInMemory();
    const turn = await aTurnOf(store);
    await turn.memory.appended([asked]);
    await turn.released();
    const { id } = await store.conversations.started(place);
    const [kept] = await rows.messages.newest(id, 1);
    await rows.messages.senderDeleted({ account: place.account, member: 'member-1' });
    await rows.conversations.leaseTaken(id, { holder: 'by-hand', now: 0, until: 1 });
    const relabelled = {
      sequence: 1,
      author: asked.author,
      sender: asked.sender,
      sealed: String(kept?.sealed),
      ...changed,
    };
    await rows.messages.appended(id, 'by-hand', [relabelled], 0);
    await rows.conversations.leaseReleased(id, 'by-hand');

    await expect((await aTurnOf(store)).memory.newest(10)).rejects.toBeInstanceOf(SealedTextRefused);
  });
});

describe('what a conversation remembers, when it cannot be read or kept', () => {
  it('cannot be read once the secret store no longer holds its key', async () => {
    const { store, keys } = chatStoreInMemory();
    const turn = await aTurnOf(store);
    await turn.memory.appended([asked]);
    await turn.released();
    await keys.forget((await store.conversations.started(place)).keyId);

    await expect((await aTurnOf(store)).memory.newest(10)).rejects.toBeInstanceOf(ConversationKeyMissing);
  });

  it('keeps nothing of a turn whose lease passed to another turn', async () => {
    const { store, clock } = chatStoreInMemory(10);
    const late = await aTurnOf(store);
    clock.moveTo(10);
    const next = await aTurnOf(store);

    await expect(late.memory.appended([asked])).rejects.toBeInstanceOf(ConversationLeaseLost);
    expect(await next.memory.newest(10)).toEqual([]);
  });
});

describe('the links of the chat store', () => {
  const member = { account: 'account-1', member: 'member-1' };

  it('are the rows’ own, a person forgotten taking their links and the starts they allowed', async () => {
    const { store, rows } = chatStoreInMemory();
    await store.links.started({ ...member, secret: 'secret-1' });
    const found = [await store.links.startFound('secret-1'), await store.links.startOf(member)];
    const ended = await store.links.startEnded({ ...member, secret: 'secret-1' });
    await store.links.linked({ ...member, person: 'person-1', linkedAt: 1 });
    await store.links.started({ ...member, secret: 'code-1', person: 'person-1' });
    const linked = await store.links.linkOf(member);

    await store.links.personForgotten('person-1');

    expect([found, ended, linked]).toEqual([
      [
        { ...member, secret: 'secret-1' },
        { ...member, secret: 'secret-1' },
      ],
      true,
      { ...member, person: 'person-1', linkedAt: 1 },
    ]);
    expect([await rows.links.linkOf(member), await rows.links.startOf(member)]).toEqual([undefined, undefined]);
  });
});
