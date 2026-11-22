import type { Statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import type { ChatDatabase } from './chat-database.ts';
import type { SealedRow } from './chat-rows.ts';
import { storedConversations } from './stored-conversations.ts';
import { storedMessages } from './stored-messages.ts';

const kinds: readonly (readonly [string, string])[] = [
  ['UPDATE chat_conversations SET lease_holder = lease_holder WHERE', 'lock'],
  ['DELETE FROM chat_messages', 'messages deleted'],
  ['DELETE FROM chat_conversations', 'conversations deleted'],
  ['INSERT INTO chat_messages', 'message appended'],
];

function described({ strings, values }: Statement): string {
  const text = strings.join('?').replaceAll(/\s+/gu, ' ').trim();
  const [, kind = text] = kinds.find(([start]) => text.startsWith(start)) ?? [];
  return `${kind} ${values.join(',')}`;
}

function aDatabaseThatRecords(mostBoundValues: number) {
  const transactions: (readonly string[])[] = [];
  const database: ChatDatabase = {
    dialect: 'sqlite',
    read: () => Promise.resolve([]),
    write: () => Promise.resolve([]),
    transaction: (statements) => {
      transactions.push(statements.map((each) => described(each)));
      return Promise.resolve([{ written: true }]);
    },
    migrated: () => Promise.resolve(),
    sharedClock: null,
    mostBoundValues,
  };
  return { database, transactions };
}

const row = (sequence: number): SealedRow => ({ sequence, author: 'person', sender: 'member-1', sealed: 'sealed' });

describe('the statements of the chat tables, in their order', () => {
  it('delete conversations in one transaction, each group locked first, its messages next and its rows last', async () => {
    const { database, transactions } = aDatabaseThatRecords(2);

    await storedConversations(database).deleted(['id-a', 'id-b', 'id-c']);

    expect(transactions).toEqual([
      [
        'lock id-a,id-b',
        'messages deleted id-a,id-b',
        'conversations deleted id-a,id-b',
        'lock id-c',
        'messages deleted id-c',
        'conversations deleted id-c',
      ],
    ]);
  });

  it('append under the same lock, taken before any row is written', async () => {
    const { database, transactions } = aDatabaseThatRecords(2);

    await storedMessages(database).appended('id-a', 'holder-1', [row(1), row(2)], 5);

    expect(transactions).toEqual([
      [
        'lock id-a,holder-1',
        'message appended 1,person,member-1,sealed,5,id-a,holder-1',
        'message appended 2,person,member-1,sealed,5,id-a,holder-1',
      ],
    ]);
  });
});
