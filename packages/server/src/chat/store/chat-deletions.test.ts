import type { Remembered } from '@on.auto/chat';
import { describe, expect, it } from 'vitest';

import { chatStoreInMemory, type ChatStoreInMemory } from '../../testing/chat/chat-store-in-memory.ts';
import type { ConversationPlace, MemberOfAnAccount } from '../tables/chat-rows.ts';
import type { ConversationAsked } from './chat-deletions.ts';
import type { ChatStore } from './chat-store.ts';

const shared = { connection: 'connection-1', account: 'account-1', conversation: 'conversation-1', thread: 'thread-1' };

const alone = { ...shared, thread: 'thread-2' };

const direct = { ...shared, conversation: 'direct-1', thread: undefined };

const elsewhere = {
  connection: 'connection-2',
  account: 'account-2',
  conversation: 'conversation-9',
  thread: 'thread-1',
};

const twin = { connection: 'connection-3', account: 'account-2', conversation: 'conversation-1', thread: 'thread-1' };

const everyPlace: readonly ConversationPlace[] = [shared, alone, direct, elsewhere, twin];

const memberOf = (account: string, member: string): MemberOfAnAccount => ({ account, member });

const by = (sender: string, text: string): Remembered => ({ author: 'person', sender, text });

const auto = (text: string): Remembered => ({ author: 'assistant', sender: undefined, text });

async function remembered(store: ChatStore, place: ConversationPlace, rows: readonly Remembered[]): Promise<void> {
  const taken = await store.conversations.leaseTaken(await store.conversations.started(place));
  if (!('leased' in taken)) {
    throw new Error('A turn holds the conversation');
  }
  await taken.leased.memory.appended(rows);
  await taken.leased.released();
}

async function linked(store: ChatStore, member: MemberOfAnAccount, person: string): Promise<void> {
  await store.links.linked({ ...member, person, linkedAt: 1 });
}

interface Scene extends ChatStoreInMemory {
  readonly keyIds: readonly string[];
}

async function aScene(): Promise<Scene> {
  const scene = chatStoreInMemory();
  const { store } = scene;
  await remembered(store, shared, [by('member-1', 'Plan A?'), auto('Plan A is set.'), by('member-2', 'Thanks')]);
  await remembered(store, alone, [by('member-1', 'Plan B?'), auto('Plan B is set.')]);
  await remembered(store, direct, [by('member-1', 'Just me'), auto('Hello')]);
  await remembered(store, elsewhere, [by('member-3', 'Plan C?'), auto('Plan C is set.')]);
  await remembered(store, twin, [by('member-1', 'Plan D?'), auto('Plan D is set.')]);
  await store.arrivals.claimed({ ...shared, message: 'message-1', kind: 'mention' });
  await store.arrivals.claimed({ ...elsewhere, message: 'message-2', kind: 'mention' });
  await store.arrivals.claimed({ ...twin, message: 'message-3', kind: 'mention' });
  await linked(store, memberOf('account-1', 'member-1'), 'person-1');
  await linked(store, memberOf('account-1', 'member-2'), 'person-2');
  await linked(store, memberOf('account-2', 'member-3'), 'person-3');
  await store.links.started({ ...memberOf('account-1', 'member-4'), secret: 'code-4', person: 'person-1' });
  await store.links.started({ ...memberOf('account-2', 'member-5'), secret: 'open-5' });
  await linked(store, memberOf('account-2', 'member-1'), 'person-9');
  await store.links.started({ ...memberOf('account-2', 'member-1'), secret: 'open-of-the-twin' });
  const keyIds = await Promise.all(everyPlace.map(async (place) => (await store.conversations.started(place)).keyId));
  return { ...scene, keyIds };
}

async function textsIn(store: ChatStore, place: ConversationPlace): Promise<readonly string[]> {
  const conversation = await store.conversations.found(place);
  if (conversation === undefined) {
    return ['deleted'];
  }
  const taken = await store.conversations.leaseTaken(conversation);
  if (!('leased' in taken)) {
    throw new Error('A turn holds the conversation');
  }
  const texts = (await taken.leased.memory.newest(100)).map(({ text }) => text);
  await taken.leased.released();
  return texts;
}

const textsOfEvery = ({ store }: Scene) => Promise.all(everyPlace.map((place) => textsIn(store, place)));

const keysKept = ({ keys, keyIds }: Scene) =>
  Promise.all(keyIds.map(async (keyId) => (await keys.read(keyId)) !== undefined));

const linksOf = ({ store }: Scene, members: readonly MemberOfAnAccount[]) =>
  Promise.all(members.map(async (member) => (await store.links.linkOf(member))?.person));

const startsOf = ({ store }: Scene, members: readonly MemberOfAnAccount[]) =>
  Promise.all(members.map(async (member) => (await store.links.startOf(member)) !== undefined));

const arrivalsOf = async ({ store }: Scene) => (await store.arrivals.unsettled()).map(({ message }) => message);

const before = {
  shared: ['Plan A?', 'Plan A is set.', 'Thanks'],
  alone: ['Plan B?', 'Plan B is set.'],
  direct: ['Just me', 'Hello'],
  elsewhere: ['Plan C?', 'Plan C is set.'],
  twin: ['Plan D?', 'Plan D is set.'],
};

const theTwin = memberOf('account-2', 'member-1');

describe('a connection that is removed', () => {
  it('takes its conversations with their keys, its arrivals, and the links and open starts of its account', async () => {
    const scene = await aScene();

    await scene.store.deletions.connectionRemoved({ connection: 'connection-1', account: 'account-1' });

    expect(await textsOfEvery(scene)).toEqual([['deleted'], ['deleted'], ['deleted'], before.elsewhere, before.twin]);
    expect(await keysKept(scene)).toEqual([false, false, false, true, true]);
    expect(await arrivalsOf(scene)).toEqual(['message-2', 'message-3']);
    expect(
      await linksOf(scene, [memberOf('account-1', 'member-2'), memberOf('account-2', 'member-3'), theTwin]),
    ).toEqual([undefined, 'person-3', 'person-9']);
    expect(
      await startsOf(scene, [memberOf('account-1', 'member-4'), memberOf('account-2', 'member-5'), theTwin]),
    ).toEqual([false, true, true]);
  });
});

describe('a member who disconnects, or a person who is removed', () => {
  it('a member who disconnects loses their link alone, and what they wrote stays', async () => {
    const scene = await aScene();

    await scene.store.deletions.disconnected(memberOf('account-1', 'member-1'));

    expect(
      await linksOf(scene, [memberOf('account-1', 'member-1'), memberOf('account-1', 'member-2'), theTwin]),
    ).toEqual([undefined, 'person-2', 'person-9']);
    expect(await startsOf(scene, [memberOf('account-1', 'member-4')])).toEqual([true]);
    expect(await textsOfEvery(scene)).toEqual(Object.values(before));
  });

  it('a person who is removed loses their links and the starts they allowed, and what they wrote stays', async () => {
    const scene = await aScene();

    await scene.store.links.personForgotten('person-1');

    expect(await linksOf(scene, [memberOf('account-1', 'member-1'), memberOf('account-1', 'member-2')])).toEqual([
      undefined,
      'person-2',
    ]);
    expect(await startsOf(scene, [memberOf('account-1', 'member-4'), memberOf('account-2', 'member-5')])).toEqual([
      false,
      true,
    ]);
    expect(await textsOfEvery(scene)).toEqual(Object.values(before));
  });
});

describe('a conversation deleted on request', () => {
  it.each<readonly [string, ConversationAsked, readonly boolean[], readonly string[]]>([
    [
      'in every thread',
      { account: 'account-1', conversation: 'conversation-1' },
      [false, false, true, true, true],
      ['message-2', 'message-3'],
    ],
    [
      'in one thread',
      { account: 'account-1', conversation: 'conversation-1', thread: 'thread-2' },
      [true, false, true, true, true],
      ['message-1', 'message-2', 'message-3'],
    ],
    [
      'in the other account that holds the same id',
      { account: 'account-2', conversation: 'conversation-1' },
      [true, true, true, true, false],
      ['message-1', 'message-2'],
    ],
  ])('goes %s with its keys and arrivals, and no other account’s', async (_case, asked, kept, arrivals) => {
    const scene = await aScene();

    const deleted = await scene.store.deletions.conversationDeleted(asked);

    expect(deleted).toBe(true);
    expect(await keysKept(scene)).toEqual(kept);
    expect((await textsOfEvery(scene)).map((texts) => texts[0] !== 'deleted')).toEqual(kept);
    expect(await arrivalsOf(scene)).toEqual(arrivals);
  });

  it('deletes nothing, and says so, where none of it is kept in that account', async () => {
    const scene = await aScene();

    const deleted = await scene.store.deletions.conversationDeleted({
      account: 'account-9',
      conversation: 'conversation-1',
    });

    expect(deleted).toBe(false);
    expect(await keysKept(scene)).toEqual([true, true, true, true, true]);
  });
});

describe('a conversation deleted on request, where only its arrivals are kept', () => {
  it.each<readonly [string, ConversationAsked, boolean, readonly string[]]>([
    ['in every thread', { account: 'account-1', conversation: 'conversation-1' }, true, []],
    [
      'in one thread',
      { account: 'account-1', conversation: 'conversation-1', thread: 'thread-1' },
      false,
      ['message-1'],
    ],
  ])('says it deleted something %s only where an arrival went: %s', async (_case, asked, deleted, left) => {
    const { store } = chatStoreInMemory();
    await store.arrivals.claimed({ ...shared, message: 'message-1', kind: 'mention' });

    expect(await store.deletions.conversationDeleted(asked)).toBe(deleted);
    expect((await store.arrivals.unsettled()).map(({ message }) => message)).toEqual(left);
  });
});

describe('a member deleted on request', () => {
  it('takes what they wrote in their account, each conversation only they wrote in with its key, and their link and start', async () => {
    const scene = await aScene();

    const deleted = await scene.store.deletions.memberDeleted(memberOf('account-1', 'member-1'));

    expect(deleted).toBe(true);
    expect(await textsOfEvery(scene)).toEqual([
      ['Plan A is set.', 'Thanks'],
      ['deleted'],
      ['deleted'],
      before.elsewhere,
      before.twin,
    ]);
    expect(await keysKept(scene)).toEqual([true, false, false, true, true]);
    expect(
      await linksOf(scene, [memberOf('account-1', 'member-1'), memberOf('account-1', 'member-2'), theTwin]),
    ).toEqual([undefined, 'person-2', 'person-9']);
    expect(await startsOf(scene, [theTwin])).toEqual([true]);
  });

  it.each<readonly [string, (store: ChatStore) => Promise<unknown>, boolean]>([
    ['nothing of theirs is kept', () => Promise.resolve(), false],
    ['only the same member id in another account is kept', (store) => linked(store, theTwin, 'person-9'), false],
    ['only their link is kept', (store) => linked(store, memberOf('account-1', 'member-1'), 'person-1'), true],
    [
      'only their open start is kept',
      (store) => store.links.started({ ...memberOf('account-1', 'member-1'), secret: 'v' }),
      true,
    ],
  ])('says whether it deleted anything where %s: %s', async (_case, kept, deleted) => {
    const { store } = chatStoreInMemory();
    await kept(store);

    expect(await store.deletions.memberDeleted(memberOf('account-1', 'member-1'))).toBe(deleted);
  });
});
