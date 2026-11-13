import { sha256Of, textToKeep, type ContentStore } from '@on.auto/content';
import { alpha, json, memoryContentStore } from '@on.auto/content/testing';
import { heldNotes, noteHolders, type HeldNote } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { HeldContentUnchecked } from '../references/held-heads.ts';
import { anErasingLedger, anErasingLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';
import { openChoresWith, type OpenChores } from '../testing/open-ledger.ts';

const notes = 'playbook/acme/alpha/notes/n1';

const first = '{"held":"first"}';

const second = '{"held":"second"}';

const texts = [first, second, '{"held":"third"}'];

const unheld = '{"held":"by nothing"}';

function kept(sha256: string): HeldNote {
  return { type: 'note_kept', data: { sha256 } };
}

async function heldIn({ ledger }: OpenChores, held: readonly string[], put: readonly string[] = held): Promise<void> {
  await Effect.runPromise(
    Effect.forEach(put, (text) => Effect.orDie(ledger.content.put(alpha, textToKeep(text, json))), { discard: true }),
  );
  await Effect.runPromise(
    ledger.execute(
      notes,
      heldNotes,
      held.map((text) => kept(sha256Of(text))),
    ),
  );
}

function foundBy({ heldContentFound }: OpenChores, most = 16) {
  return Effect.runPromise(heldContentFound(most));
}

function holdingOwn(entry: LedgerEntry, database: string): Promise<OpenChores> {
  return anErasingLedger(entry, noteHolders, database);
}

function holdingOutside(entry: LedgerEntry, database: string, store: ContentStore): Promise<OpenChores> {
  return anErasingLedgerOutside(entry, noteHolders, store, database);
}

function whereItKeepsContent(entry: LedgerEntry): void {
  it('finds every content its facts hold in its own tables, where it keeps content, and checks no content nothing holds', async () => {
    const own = await holdingOwn(entry, await entry.aDatabase());
    await heldIn(own, [first, second], [first, second, unheld]);

    expect(await foundBy(own)).toEqual({ checked: 2, keptElsewhere: 0, missing: 0 });
  });

  it('finds every content its facts hold in the store outside it, where it keeps content, and checks no content nothing holds', async () => {
    const outside = await holdingOutside(entry, await entry.aDatabase(), memoryContentStore());
    await heldIn(outside, [first, second], [first, second, unheld]);

    expect(await foundBy(outside)).toEqual({ checked: 2, keptElsewhere: 0, missing: 0 });
  });

  it('checks at most as many as it is asked, the first by the key of their playbook and their digest', async () => {
    const own = await holdingOwn(entry, await entry.aDatabase());
    await heldIn(own, texts);

    expect([await foundBy(own, 2), await foundBy(own, 1)]).toEqual([
      { checked: 2, keptElsewhere: 0, missing: 0 },
      { checked: 1, keptElsewhere: 0, missing: 0 },
    ]);
  });
}

function inTheOtherPlace(entry: LedgerEntry): void {
  it('counts as kept elsewhere the content its facts hold in its own tables once it is given a store outside it', async () => {
    const database = await entry.aDatabase();
    await heldIn(await holdingOwn(entry, database), texts);

    const outside = await holdingOutside(entry, database, memoryContentStore());

    expect(await foundBy(outside)).toEqual({ checked: 3, keptElsewhere: 3, missing: 0 });
  });

  it('counts as kept elsewhere the content its facts hold in a store outside it once it is opened without one', async () => {
    const database = await entry.aDatabase();
    await heldIn(await holdingOutside(entry, database, memoryContentStore()), texts);

    const own = await holdingOwn(entry, database);

    expect(await foundBy(own)).toEqual({ checked: 3, keptElsewhere: 3, missing: 0 });
  });
}

function missingFromItsStore(entry: LedgerEntry): void {
  it('counts as missing the content its facts hold that the store outside it does not keep, as another store or one emptied', async () => {
    const database = await entry.aDatabase();
    const store = memoryContentStore();
    await heldIn(await holdingOutside(entry, database, store), texts);
    await Effect.runPromise(store.delete(alpha, sha256Of(first)));

    const emptied = await holdingOutside(entry, database, store);
    const another = await holdingOutside(entry, database, memoryContentStore());

    expect([await foundBy(emptied), await foundBy(another)]).toEqual([
      { checked: 3, keptElsewhere: 0, missing: 1 },
      { checked: 3, keptElsewhere: 0, missing: 3 },
    ]);
  });

  it('counts as missing a digest its facts hold of which it keeps no head, and passes over a content whose bytes were erased', async () => {
    const database = await entry.aDatabase();
    const own = await holdingOwn(entry, database);
    await heldIn(own, texts, texts.slice(0, 2));
    await entry.queried(
      database,
      `UPDATE recorded_content_heads SET erased_at = 1 WHERE sha256 = '${sha256Of(second)}'`,
    );

    expect(await foundBy(own)).toEqual({ checked: 2, keptElsewhere: 0, missing: 1 });
  });

  it('counts as missing a content held under a key that names no playbook, since no store keeps content but a playbook’s', async () => {
    const database = await entry.aDatabase();
    const outside = await holdingOutside(entry, database, memoryContentStore());
    const sha256 = sha256Of(unheld);
    await entry.queried(
      database,
      `INSERT INTO content_references_1 (playbook_key, stream, sha256, held) VALUES ('org/acme/', 'notes/n1', '${sha256}', 1)`,
    );
    await entry.queried(
      database,
      `INSERT INTO recorded_content_heads (playbook_key, sha256, upload_id, bytes, chunks, media_type, kept_in)
        VALUES ('org/acme/', '${sha256}', '', 0, 0, 'application/json', 'external')`,
    );

    expect(await foundBy(outside)).toEqual({ checked: 1, keptElsewhere: 0, missing: 1 });
  });
}

function foundAsTheReadFindsIt(entry: LedgerEntry): void {
  it('counts as found a content whose bytes its store outside holds, whatever head stands, as a read finds it: one with no head, as one kept before heads were, and one whose head its own tables took over', async () => {
    const database = await entry.aDatabase();
    const outside = await holdingOutside(entry, database, memoryContentStore());
    await heldIn(outside, [first, second]);
    await entry.queried(database, `DELETE FROM recorded_content_heads WHERE sha256 = '${sha256Of(first)}'`);
    await entry.queried(
      database,
      `UPDATE recorded_content_heads SET kept_in = 'ledger' WHERE sha256 = '${sha256Of(second)}'`,
    );

    expect(await foundBy(outside)).toEqual({ checked: 2, keptElsewhere: 0, missing: 0 });
  });

  it('fails as unchecked, never as missing, where its store outside cannot be asked', async () => {
    const database = await entry.aDatabase();
    const store = memoryContentStore();
    await heldIn(await holdingOutside(entry, database, store), [first]);
    const unreachable = new Error('connect ECONNREFUSED');
    const failing = await holdingOutside(entry, database, { ...store, holds: () => Effect.die(unreachable) });

    expect(await Effect.runPromise(Effect.flip(failing.heldContentFound(16)))).toEqual(
      new HeldContentUnchecked({ failure: unreachable }),
    );
  });
}

function withoutTheHolders(entry: LedgerEntry): void {
  it('cannot say what its facts hold when it was opened without the facts that hold content', async () => {
    const chores = await openChoresWith(entry.ledgerOn(await entry.aDatabase()));
    onTestFinished(chores.dispose);

    await expect(foundBy(chores)).rejects.toThrow('The ledger was opened without the facts that hold content');
  });
}

export function heldContentFoundBehaviour(entry: LedgerEntry): void {
  describe('the content the facts of a ledger hold, looked for where it keeps content', () => {
    whereItKeepsContent(entry);
    inTheOtherPlace(entry);
    missingFromItsStore(entry);
    foundAsTheReadFindsIt(entry);
    withoutTheHolders(entry);
  });
}
