import { describe, expect, it } from 'vitest';

import type { Arrival, ChatRows, SealedRow } from './chat-rows.ts';

interface RowsEntry {
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

const ambient: Arrival = { ...arrival, kind: 'ambient' };

function arrivalsOutrankedBehaviour({ name, rowsOf }: RowsEntry): void {
  describe(`the arrivals ${name}, outranked or passed over`, () => {
    it.each<readonly [string, (rows: ChatRows) => Promise<unknown>, string, string | undefined]>([
      ['passed over', (rows) => rows.arrivals.passed(ambient), 'taken', 'mention'],
      ['still being taken', () => Promise.resolve(), 'handed', 'mention'],
      ['settled', (rows) => rows.arrivals.settled(ambient), 'kept', 'ambient'],
    ])('let a message of a higher kind outrank one %s', async (_case, before, outranking, kind) => {
      const rows = await rowsOf();
      await rows.arrivals.claimed(ambient, 1);
      await before(rows);

      expect([await rows.arrivals.outranked(arrival, 'ambient'), await rows.arrivals.kindOf(arrival)]).toEqual([
        outranking,
        kind,
      ]);
    });

    it('let nothing outrank a message taken as its own kind, or one never taken', async () => {
      const rows = await rowsOf();
      await rows.arrivals.claimed(arrival, 1);

      expect([
        await rows.arrivals.outranked(arrival, 'ambient'),
        await rows.arrivals.outranked({ ...arrival, message: 'never-taken' }, 'ambient'),
        await rows.arrivals.kindOf({ ...arrival, message: 'never-taken' }),
      ]).toEqual(['kept', 'kept', undefined]);
    });

    it('pass a message over once, as the kind it was taken as, and leave it out of what is not settled', async () => {
      const rows = await rowsOf();
      await rows.arrivals.claimed(ambient, 1);
      await rows.arrivals.claimed({ ...ambient, message: 'outranked' }, 2);
      await rows.arrivals.outranked({ ...arrival, message: 'outranked' }, 'ambient');

      expect([
        await rows.arrivals.passed(ambient),
        await rows.arrivals.passed(ambient),
        await rows.arrivals.passed({ ...ambient, message: 'outranked' }),
        await rows.arrivals.unsettled(),
      ]).toEqual([true, false, false, [{ ...arrival, message: 'outranked' }]]);
    });
  });
}

const spokenIn = {
  connection: 'connection-1',
  account: 'account-1',
  conversation: 'conversation-1',
  thread: undefined,
};

const byMember = (sequence: number, sender = 'member-1'): SealedRow => ({
  sequence,
  author: 'person',
  sender,
  sealed: `sealed-${sequence}`,
});

function spokenBehaviour({ name, rowsOf }: RowsEntry): void {
  describe(`the conversations ${name}, by who spoke to Auto in them`, () => {
    it('say whether a member spoke to Auto in a conversation, by what they asked there', async () => {
      const rows = await rowsOf();
      const overheard: SealedRow = { ...byMember(3, 'member-2'), author: 'overheard' };
      const byAuto: SealedRow = { sequence: 2, author: 'assistant', sender: undefined, sealed: 'sealed-2' };
      await rows.conversations.made({ ...spokenIn, id: 'id-s', keyId: 'key-of-id-s' }, 1);
      await rows.conversations.leaseTaken('id-s', { holder: 'holder-1', now: 1, until: 1_000 });
      await rows.messages.appended('id-s', 'holder-1', [byMember(1), byAuto, overheard], 2);

      expect([
        await rows.conversations.spokenIn('id-s', 'member-1'),
        await rows.conversations.spokenIn('id-s', 'member-2'),
        await rows.conversations.spokenIn('id-other', 'member-1'),
      ]).toEqual([true, false, false]);
    });
  });
}

export function chatReadsBehaviour(entry: RowsEntry): void {
  arrivalsOutrankedBehaviour(entry);
  spokenBehaviour(entry);
}
