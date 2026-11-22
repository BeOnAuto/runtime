import { existsSync } from 'node:fs';

import type { Remembered } from '@on.auto/chat';
import { statement } from '@on.auto/ledger';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatStore } from '../chat/store/chat-store.ts';
import { chatKeptAt } from '../testing/chat/chat-kept-at.ts';
import { onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runAdminCommand } from './run-admin-command.ts';

const ledgers: TemporaryLedger[] = [];

afterEach(() => {
  for (const { remove } of ledgers.splice(0)) {
    remove();
  }
});

function aLedgerFile(): string {
  const ledger = temporaryLedger();
  ledgers.push(ledger);
  return ledger.fileName;
}

interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly errors: readonly string[];
}

async function ran(args: readonly string[], LEDGER_FILE: string): Promise<Ran> {
  const out: string[] = [];
  const errors: string[] = [];
  const code = await runAdminCommand(['delete-chat', ...args], {
    environment: { LEDGER_FILE },
    console: {
      log: (line) => {
        out.push(line);
      },
      error: (line) => {
        errors.push(line);
      },
    },
    usage: 'the usage of the test',
  });
  return { code, out, errors };
}

const shared = { connection: 'connection-1', account: 'account-1', conversation: 'conversation-1', thread: 'thread-1' };

const alone = { ...shared, thread: 'thread-2' };

const twin = { ...shared, connection: 'connection-2', account: 'account-2' };

const member = { account: 'account-1', member: 'member-1' };

const theTwin = { account: 'account-2', member: 'member-1' };

const by = (sender: string, text: string): Remembered => ({ author: 'person', sender, text });

const auto = (text: string): Remembered => ({ author: 'assistant', sender: undefined, text });

async function remembered(chat: ChatStore, place: Readonly<typeof shared>, rows: readonly Remembered[]): Promise<void> {
  const taken = await chat.conversations.leaseTaken(await chat.conversations.started(place));
  if (!('leased' in taken)) {
    throw new Error('A turn holds the conversation');
  }
  await taken.leased.memory.appended(rows);
  await taken.leased.released();
}

async function aChatKept(LEDGER_FILE: string): Promise<void> {
  await chatKeptAt(LEDGER_FILE, async (chat) => {
    await remembered(chat, shared, [by('member-1', 'Plan A?'), auto('Plan A is set.'), by('member-2', 'Thanks')]);
    await remembered(chat, alone, [by('member-1', 'Plan B?'), auto('Plan B is set.')]);
    await remembered(chat, twin, [by('member-1', 'Plan D?'), auto('Plan D is set.')]);
    await chat.links.linked({ ...member, person: 'person-1', linkedAt: 1 });
    await chat.links.linked({ ...theTwin, person: 'person-9', linkedAt: 1 });
  });
}

async function textsIn(chat: ChatStore, place: Readonly<typeof shared>): Promise<readonly string[]> {
  const conversation = await chat.conversations.found(place);
  if (conversation === undefined) {
    return ['deleted'];
  }
  const taken = await chat.conversations.leaseTaken(conversation);
  if (!('leased' in taken)) {
    throw new Error('A turn holds the conversation');
  }
  const texts = (await taken.leased.memory.newest(100)).map(({ text }) => text);
  await taken.leased.released();
  return texts;
}

const keptAt = (LEDGER_FILE: string) =>
  chatKeptAt(LEDGER_FILE, async (chat) => [
    await textsIn(chat, shared),
    await textsIn(chat, alone),
    await textsIn(chat, twin),
    [(await chat.links.linkOf(member))?.person ?? 'no link', (await chat.links.linkOf(theTwin))?.person ?? 'no link'],
  ]);

const twinKept = ['Plan D?', 'Plan D is set.'];

describe('admin delete-chat member', () => {
  it('deletes what the member wrote, each conversation only they wrote in, and their link, and finds nothing again', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aChatKept(LEDGER_FILE);

    const deleted = await ran(['member', 'account-1', 'member-1'], LEDGER_FILE);
    const again = await ran(['member', 'account-1', 'member-1'], LEDGER_FILE);

    expect([deleted.code, deleted.out.length, deleted.errors]).toEqual([0, 1, []]);
    expect([again.code, again.out.length, again.errors]).toEqual([0, 2, []]);
    expect(again.out[1]).toContain(LEDGER_FILE);
    expect(await keptAt(LEDGER_FILE)).toEqual([
      ['Plan A is set.', 'Thanks'],
      ['deleted'],
      twinKept,
      ['no link', 'person-9'],
    ]);
  });
});

describe('admin delete-chat conversation', () => {
  it.each<readonly [string, readonly string[], readonly (readonly string[])[]]>([
    [
      'in every thread',
      ['conversation', 'account-1', 'conversation-1'],
      [['deleted'], ['deleted'], twinKept, ['person-1', 'person-9']],
    ],
    [
      'in one thread',
      ['conversation', 'account-1', 'conversation-1', 'thread-2'],
      [['Plan A?', 'Plan A is set.', 'Thanks'], ['deleted'], twinKept, ['person-1', 'person-9']],
    ],
    [
      'in the other account that holds the same id',
      ['conversation', 'account-2', 'conversation-1'],
      [['Plan A?', 'Plan A is set.', 'Thanks'], ['Plan B?', 'Plan B is set.'], ['deleted'], ['person-1', 'person-9']],
    ],
  ])('deletes the conversation %s, and no other account’s, and finds nothing again', async (_case, args, kept) => {
    const LEDGER_FILE = aLedgerFile();
    await aChatKept(LEDGER_FILE);

    const deleted = await ran(args, LEDGER_FILE);
    const again = await ran(args, LEDGER_FILE);

    expect([deleted.code, deleted.out.length, again.code, again.out.length]).toEqual([0, 1, 0, 2]);
    expect(await keptAt(LEDGER_FILE)).toEqual(kept);
  });
});

describe('admin delete-chat, refused', () => {
  it.each<readonly [readonly string[]]>([
    [[]],
    [['member']],
    [['member', 'account-1']],
    [['member', 'account-1', 'member-1', 'thread-1']],
    [['someone', 'account-1', 'member-1']],
    [['conversation', 'account-1']],
  ])('refuses %j and opens no ledger', async (args) => {
    const LEDGER_FILE = aLedgerFile();

    expect(await ran(args, LEDGER_FILE)).toMatchObject({ code: 1, out: [] });
    expect(existsSync(LEDGER_FILE)).toBe(false);
  });

  it('refuses chat tables of a newer release, and deletes nothing', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aChatKept(LEDGER_FILE);
    await onTheLedgerIn(LEDGER_FILE, (connection) => connection.write(statement`UPDATE chat_layout SET layout = 2`));

    const refused = await ran(['member', 'account-1', 'member-1'], LEDGER_FILE);
    await onTheLedgerIn(LEDGER_FILE, (connection) => connection.write(statement`UPDATE chat_layout SET layout = 1`));

    expect([refused.code, refused.out, refused.errors.length]).toEqual([1, [], 1]);
    expect(await keptAt(LEDGER_FILE)).toEqual([
      ['Plan A?', 'Plan A is set.', 'Thanks'],
      ['Plan B?', 'Plan B is set.'],
      twinKept,
      ['person-1', 'person-9'],
    ]);
  });
});
