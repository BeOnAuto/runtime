import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { happenings, noted, stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openConnectionWith, type OpenConnection } from '../testing/open-ledger.ts';
import { streamAppends, streamSignalOf, type StreamSignal } from './append-signal.ts';

function heardOn(signal: StreamSignal): readonly string[] {
  const heard: string[] = [];
  onTestFinished(
    signal.listen((stream) => {
      heard.push(stream);
    }),
  );
  return heard;
}

async function aLedgerSignalling(entry: LedgerEntry, appended: StreamSignal): Promise<OpenConnection> {
  const opened = await openConnectionWith(entry.ledgerRaisingOn(await entry.aDatabase(), appended));
  onTestFinished(opened.dispose);
  return opened;
}

export function storeSignalsBehaviour(entry: LedgerEntry): void {
  describe('the signal of the appends of a ledger given one of its own', () => {
    it('is raised by its ledger and the streams of its connection, and by no other ledger of the process', async () => {
      const [one, other] = [streamSignalOf(), streamSignalOf()];
      const heard = [heardOn(one), heardOn(other), heardOn(streamAppends)];
      const first = await aLedgerSignalling(entry, one);
      const second = await aLedgerSignalling(entry, other);

      await Effect.runPromise(first.ledger.execute('playbook/acme/alpha/notes', happenings, [noted('noted')]));
      await second.connection.streams.append('playbook/acme/beta/run-logs/r1', [{ type: 'noted', data: { n: 1 } }], {
        expectedVersion: 0,
        context: stamped,
      });

      expect(heard).toEqual([['playbook/acme/alpha/notes'], ['playbook/acme/beta/run-logs/r1'], []]);
    });
  });
}
