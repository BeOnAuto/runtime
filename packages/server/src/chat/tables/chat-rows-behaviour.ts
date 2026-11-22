import { describe, expect, it } from 'vitest';

import type {
  Arrival,
  ArrivalsSelected,
  ChatRows,
  ConversationRow,
  ConversationsSelected,
  SealedRow,
} from './chat-rows.ts';

export interface ChatRowsEntry {
  readonly name: string;
  readonly rowsOf: () => Promise<ChatRows>;
}

const arrival: Arrival = {
  connection: 'connection-1',
  account: 'account-1',
  conversation: 'conversation-1',
  message: 'message-1',
  kind: 'mention',
};

const place = { connection: 'connection-1', account: 'account-1', conversation: 'conversation-1', thread: 'thread-1' };

const conversationAt = (id: string, changed: Partial<ConversationRow> = {}): ConversationRow => ({
  ...place,
  id,
  keyId: `key-of-${id}`,
  ...changed,
});

const byMember = (sequence: number, sender = 'member-1'): SealedRow => ({
  sequence,
  author: 'person',
  sender,
  sealed: `sealed-${sequence}`,
});

const byAuto = (sequence: number): SealedRow => ({
  sequence,
  author: 'assistant',
  sender: undefined,
  sealed: `sealed-${sequence}`,
});

async function held(rows: ChatRows, conversation: ConversationRow, holder = 'holder-1'): Promise<void> {
  await rows.conversations.made(conversation, 1);
  await rows.conversations.leaseTaken(conversation.id, { holder, now: 1, until: 1_000 });
}

async function writtenTo(rows: ChatRows, conversation: ConversationRow, written: readonly [SealedRow, ...SealedRow[]]) {
  await held(rows, conversation);
  await rows.messages.appended(conversation.id, 'holder-1', written, 2);
}

function arrivalsBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the arrivals ${name}`, () => {
    it.each<readonly [string, Partial<Arrival>, boolean]>([
      ['the same message again, of another kind', { kind: 'reply' }, false],
      ['another message', { message: 'message-2' }, true],
      ['the same message id in another conversation', { conversation: 'conversation-2' }, true],
      ['the same message id of another account', { account: 'account-2' }, true],
      ['the same message id through another connection', { connection: 'connection-2' }, true],
    ])('take the first arrival of a message, and %s is taken: %s', async (_case, changed, taken) => {
      const rows = await rowsOf();
      const first = await rows.arrivals.claimed(arrival, 1);

      expect([first, await rows.arrivals.claimed({ ...arrival, ...changed }, 2)]).toEqual([true, taken]);
    });

    it('list the arrivals taken and not settled, in the order they arrived', async () => {
      const rows = await rowsOf();
      const late = { ...arrival, message: 'late' };
      const early = { ...arrival, message: 'early' };
      const settled = { ...arrival, message: 'settled' };
      await rows.arrivals.claimed(late, 3);
      await rows.arrivals.claimed(early, 2);
      await rows.arrivals.claimed(settled, 1);

      await rows.arrivals.settled(settled);
      await rows.arrivals.settled({ ...arrival, message: 'never-taken' });

      expect(await rows.arrivals.unsettled()).toEqual([early, late]);
      expect(await rows.arrivals.claimed(settled, 4)).toBe(false);
    });
  });
}

function arrivalsDeletedBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the arrivals ${name}, deleted`, () => {
    it.each<readonly [ArrivalsSelected, readonly string[]]>([
      [{ connection: 'connection-1' }, ['connection-2 account-1 conversation-1']],
      [
        { account: 'account-1', conversation: 'conversation-1' },
        ['connection-1 account-1 conversation-2', 'connection-1 account-2 conversation-1'],
      ],
    ])('delete the arrivals %j and no other, the same conversation in another account kept', async (selected, left) => {
      const rows = await rowsOf();
      await rows.arrivals.claimed(arrival, 1);
      await rows.arrivals.claimed({ ...arrival, conversation: 'conversation-2' }, 2);
      await rows.arrivals.claimed({ ...arrival, connection: 'connection-2' }, 3);
      await rows.arrivals.claimed({ ...arrival, account: 'account-2' }, 4);

      const deleted = await rows.arrivals.deleted(selected);
      const kept = await rows.arrivals.unsettled();

      expect([deleted, await rows.arrivals.deleted(selected)]).toEqual([true, false]);
      expect(kept.map((each) => `${each.connection} ${each.account} ${each.conversation}`)).toEqual(left);
    });
  });
}

function makingBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the conversations ${name}`, () => {
    it('make one conversation of a place, find it by that place, and keep one with no thread apart', async () => {
      const rows = await rowsOf();
      const direct = { ...place, thread: undefined };

      const made = [
        await rows.conversations.made(conversationAt('id-a'), 1),
        await rows.conversations.made(conversationAt('id-b'), 2),
        await rows.conversations.made(conversationAt('id-c', direct), 3),
      ];

      expect(made).toEqual([true, false, true]);
      expect(await rows.conversations.found(place)).toEqual(conversationAt('id-a'));
      expect(await rows.conversations.found(direct)).toEqual(conversationAt('id-c', direct));
      expect(await rows.conversations.found({ ...place, thread: 'thread-2' })).toBeUndefined();
    });

    it('lease a conversation that is free', async () => {
      const rows = await rowsOf();
      await rows.conversations.made(conversationAt('id-a'), 1);

      expect(await rows.conversations.leaseTaken('id-a', { holder: 'first', now: 100, until: 200 })).toBe(true);
    });

    it.each([
      ['held by another turn', 101, false],
      ['passed at that moment', 100, true],
      ['passed', 50, true],
    ])('lease a conversation whose lease is %s: %s', async (_case, heldUntil, taken) => {
      const rows = await rowsOf();
      await rows.conversations.made(conversationAt('id-a'), 1);
      await rows.conversations.leaseTaken('id-a', { holder: 'first', now: 0, until: heldUntil });

      expect(await rows.conversations.leaseTaken('id-a', { holder: 'second', now: 100, until: 200 })).toBe(taken);
    });
  });
}

function releasingBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the conversations ${name}, released`, () => {
    it('free a conversation for its holder alone, and lease none it does not keep', async () => {
      const rows = await rowsOf();
      await held(rows, conversationAt('id-a'), 'first');

      await rows.conversations.leaseReleased('id-a', 'second');
      const whileHeld = await rows.conversations.leaseTaken('id-a', { holder: 'third', now: 2, until: 3 });
      await rows.conversations.leaseReleased('id-a', 'first');
      const afterwards = await rows.conversations.leaseTaken('id-a', { holder: 'third', now: 2, until: 3 });

      expect([whileHeld, afterwards]).toEqual([false, true]);
      expect(await rows.conversations.leaseTaken('id-missing', { holder: 'third', now: 2, until: 3 })).toBe(false);
    });
  });
}

function selectingBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the conversations ${name}, selected`, () => {
    it.each<readonly [string, ConversationsSelected, readonly string[]]>([
      ['of a connection', { connection: 'connection-1' }, ['id-a', 'id-b', 'id-d', 'id-e']],
      [
        'of a conversation, in every thread',
        { account: 'account-1', conversation: 'conversation-1' },
        ['id-a', 'id-b', 'id-c'],
      ],
      ['of one thread', { account: 'account-1', conversation: 'conversation-1', thread: 'thread-1' }, ['id-a', 'id-c']],
      [
        'of the same conversation in another account',
        { account: 'account-2', conversation: 'conversation-1' },
        ['id-e'],
      ],
      ['of nothing kept', { connection: 'connection-9' }, []],
    ])('answer the conversations %s with their keys', async (_case, selected, ids) => {
      const rows = await rowsOf();
      await rows.conversations.made(conversationAt('id-a'), 1);
      await rows.conversations.made(conversationAt('id-b', { thread: undefined }), 1);
      await rows.conversations.made(conversationAt('id-c', { connection: 'connection-2' }), 1);
      await rows.conversations.made(conversationAt('id-d', { conversation: 'conversation-2' }), 1);
      await rows.conversations.made(conversationAt('id-e', { account: 'account-2' }), 1);

      expect(await rows.conversations.selected(selected)).toEqual(ids.map((id) => ({ id, keyId: `key-of-${id}` })));
    });
  });
}

function writtenBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the conversations ${name}, by who wrote in them`, () => {
    it('answer the conversations a member of an account wrote in, each with everyone who wrote in it', async () => {
      const rows = await rowsOf();
      await writtenTo(rows, conversationAt('id-a'), [byMember(1), byAuto(2), byMember(3, 'member-2')]);
      await writtenTo(rows, conversationAt('id-b', { thread: 'thread-2' }), [byMember(1)]);
      await writtenTo(rows, conversationAt('id-c', { thread: 'thread-3' }), [byMember(1, 'member-2')]);
      await writtenTo(rows, conversationAt('id-d', { account: 'account-2' }), [byMember(1)]);

      expect(await rows.conversations.writtenIn({ account: 'account-1', member: 'member-1' })).toEqual([
        { id: 'id-a', keyId: 'key-of-id-a', senders: ['member-1', 'member-2'] },
        { id: 'id-b', keyId: 'key-of-id-b', senders: ['member-1'] },
      ]);
      expect(await rows.conversations.writtenIn({ account: 'account-2', member: 'member-1' })).toEqual([
        { id: 'id-d', keyId: 'key-of-id-d', senders: ['member-1'] },
      ]);
      expect(await rows.conversations.writtenIn({ account: 'account-1', member: 'member-9' })).toEqual([]);
    });

    it('delete the conversations named, with every row of them, and no other', async () => {
      const rows = await rowsOf();
      await writtenTo(rows, conversationAt('id-a'), [byMember(1)]);
      await writtenTo(rows, conversationAt('id-b', { thread: 'thread-2' }), [byMember(1)]);
      await writtenTo(rows, conversationAt('id-c', { thread: 'thread-3' }), [byMember(1)]);

      await rows.conversations.deleted(['id-a', 'id-c']);
      await rows.conversations.deleted([]);

      expect(await rows.conversations.selected({ connection: 'connection-1' })).toEqual([
        { id: 'id-b', keyId: 'key-of-id-b' },
      ]);
      expect([await rows.messages.newest('id-a', 9), await rows.messages.newest('id-b', 9)]).toEqual([
        [],
        [byMember(1)],
      ]);
    });
  });
}

const takenByAnother = (rows: ChatRows) =>
  rows.conversations.leaseTaken('id-a', { holder: 'other', now: 2_000, until: 3_000 });

function messagesBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the messages ${name}`, () => {
    it('append rows while the lease is held, read the newest in their order, and say which was last', async () => {
      const rows = await rowsOf();
      const before = await rows.messages.last('id-a');

      await writtenTo(rows, conversationAt('id-a'), [byMember(1), byAuto(2), byMember(3)]);

      expect(await rows.messages.newest('id-a', 2)).toEqual([byAuto(2), byMember(3)]);
      expect(await rows.messages.newest('id-a', 5)).toEqual([byMember(1), byAuto(2), byMember(3)]);
      expect([before, await rows.messages.last('id-a')]).toEqual([0, 3]);
    });

    it.each<readonly [string, (rows: ChatRows) => Promise<unknown>]>([
      ['another turn holds the lease', takenByAnother],
      ['the lease was released', (rows) => rows.conversations.leaseReleased('id-a', 'holder-1')],
      ['the conversation was deleted', (rows) => rows.conversations.deleted(['id-a'])],
    ])('append nothing where %s', async (_case, before) => {
      const rows = await rowsOf();
      await held(rows, conversationAt('id-a'));
      await before(rows);

      expect(await rows.messages.appended('id-a', 'holder-1', [byMember(1)], 2)).toBe(false);
      expect(await rows.messages.newest('id-a', 9)).toEqual([]);
    });

    it('refuse a batch that would write over a row it keeps, and keep none of the batch', async () => {
      const rows = await rowsOf();
      await writtenTo(rows, conversationAt('id-a'), [byMember(1)]);

      const written = rows.messages.appended('id-a', 'holder-1', [byMember(2), byMember(1)], 3);

      await expect(written).rejects.toBeInstanceOf(Error);
      expect(await rows.messages.newest('id-a', 9)).toEqual([byMember(1)]);
    });

    it('delete every row a member of an account wrote, and no other, the same member id in another account kept', async () => {
      const rows = await rowsOf();
      await writtenTo(rows, conversationAt('id-a'), [byMember(1), byAuto(2), byMember(3, 'member-2')]);
      await writtenTo(rows, conversationAt('id-b', { account: 'account-2' }), [byMember(1)]);

      await rows.messages.senderDeleted({ account: 'account-1', member: 'member-1' });

      expect(await rows.messages.newest('id-a', 9)).toEqual([byAuto(2), byMember(3, 'member-2')]);
      expect(await rows.messages.newest('id-b', 9)).toEqual([byMember(1)]);
    });
  });
}

export function chatRowsBehaviour(entry: ChatRowsEntry): void {
  arrivalsBehaviour(entry);
  arrivalsDeletedBehaviour(entry);
  makingBehaviour(entry);
  releasingBehaviour(entry);
  selectingBehaviour(entry);
  writtenBehaviour(entry);
  messagesBehaviour(entry);
}
