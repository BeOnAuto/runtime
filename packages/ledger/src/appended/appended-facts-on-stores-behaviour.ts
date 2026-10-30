import { appendedFactsBehaviour } from '@on.auto/operations/testing';
import { Clock, Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { streamSignalOf } from '../signal/append-signal.ts';
import { happenings, noted } from '../testing/happenings.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { openChoresWith, openConnectionWith, type OpenConnection } from '../testing/open-ledger.ts';

const alpha = { kind: 'playbook', playbook: { org: 'acme', playbook: 'alpha' } } as const;

async function aLedgerOfItsOwnSignalOn(entry: LedgerEntry, database: string): Promise<OpenConnection> {
  const opened = await openConnectionWith(entry.ledgerRaisingOn(database, streamSignalOf()));
  onTestFinished(opened.dispose);
  return opened;
}

function wokenFromElsewhere(entry: LedgerEntry): void {
  it('wakes a wait for an append another ledger made on the same database, which no signal of its own tells it of', async () => {
    const database = await entry.aDatabase();
    const waiting = await aLedgerOfItsOwnSignalOn(entry, database);
    const appending = await aLedgerOfItsOwnSignalOn(entry, database);
    const now = await Effect.runPromise(waiting.ledger.readAppendedFacts(alpha, { most: 10, dataOf: [] }));
    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 20_000;

    const started = performance.now();
    const woken = Effect.runPromise(waiting.ledger.waitForAppend(alpha, now.through, deadline));
    await Effect.runPromise(appending.ledger.execute('playbook/acme/alpha/notes', happenings, [noted('elsewhere')]));
    await woken;
    const after = await Effect.runPromise(
      waiting.ledger.readAppendedFacts(alpha, { after: now.cursor, most: 10, dataOf: [] }),
    );

    expect(performance.now() - started).toBeLessThan(10_000);
    expect(after.facts.map(({ stream }) => stream)).toEqual(['playbook/acme/alpha/notes']);
  });
}

function endedAtStop(entry: LedgerEntry): void {
  it('ends every wait at once when its waits are ended, as the server ends them when it stops, and every wait after', async () => {
    const { ledger, waitsEnded, dispose } = await openChoresWith(entry.ledgerOn(await entry.aDatabase()));
    onTestFinished(dispose);
    const now = await Effect.runPromise(ledger.readAppendedFacts(alpha, { most: 10, dataOf: [] }));
    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 20_000;

    const started = performance.now();
    const held = Effect.runPromise(ledger.waitForAppend(alpha, now.through, deadline));
    await waitsEnded();
    const ended = await held;
    const after = await Effect.runPromise(ledger.waitForAppend(alpha, now.through, deadline));

    expect([ended, after, performance.now() - started < 5000]).toEqual(['ended', 'ended', true]);
  });
}

export function appendedFactsOnStoresBehaviour(entry: LedgerEntry): void {
  appendedFactsBehaviour({ aLedger: () => aLedger(entry) });

  describe('a wait for an append on a store', () => {
    wokenFromElsewhere(entry);
    endedAtStop(entry);
  });
}
