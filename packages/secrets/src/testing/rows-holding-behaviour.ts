import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { heldElsewhere, rewrapped, sealedHolding } from './holdings.ts';
import { aLease, at, firstMoment, isoOf, rowsIn, rowsOpenedOn, type SecretsEntry } from './secrets-entry.ts';

function heldByAKeeper(entry: SecretsEntry): void {
  it('answer the rows a keeper holds in the order of their ids, under a kid where one is named, after an id where one is named, at most as many as asked', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(
      Effect.all([
        rows.keep('secret-3', sealedHolding('third')),
        rows.keep('secret-1', sealedHolding('first')),
        rows.keep('secret-2', sealedHolding('second', 'kid-b')),
        rows.keep('secret-4', heldElsewhere),
        rows.replace('secret-3', 1, sealedHolding('third')),
      ]),
    );
    const [first, second, third] = [
      { id: 'secret-1', version: 1, holding: sealedHolding('first') },
      { id: 'secret-2', version: 1, holding: sealedHolding('second', 'kid-b') },
      { id: 'secret-3', version: 2, holding: sealedHolding('third') },
    ];

    const held = await Effect.runPromise(
      Effect.all([
        rows.heldBy({ keptBy: 'ledger', kid: 'kid-a' }, 100),
        rows.heldBy({ keptBy: 'ledger', kid: 'kid-a' }, 1),
        rows.heldBy({ keptBy: 'ledger' }, 100),
        rows.heldBy({ keptBy: 'another-keeper' }, 100),
        rows.heldBy({ keptBy: 'ledger', kid: 'kid-c' }, 100),
        rows.heldBy({ keptBy: 'ledger' }, 100, 'secret-1'),
        rows.heldBy({ keptBy: 'ledger', kid: 'kid-a' }, 1, 'secret-1'),
        rows.heldBy({ keptBy: 'ledger' }, 100, 'secret-3'),
      ]),
    );

    expect(held).toEqual([
      [first, third],
      [first],
      [first, second, third],
      [{ id: 'secret-4', version: 1, holding: heldElsewhere }],
      [],
      [second, third],
      [third],
      [],
    ]);
  });
}

function heldAgain(entry: SecretsEntry): void {
  it('hold a row again only while its version and its holding are the ones read, keeping its version, its claim, its ending and when it was kept', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await at(firstMoment, rows.keep('secret-1', sealedHolding('first'), '1234'));
    await at(firstMoment, rows.claim('secret-1', 1, aLease));
    const read = { id: 'secret-1', version: 1, holding: sealedHolding('first') };

    const reheld = [
      await at(firstMoment + 1000, rows.reheld(read, rewrapped('first', 'kid-b'))),
      await at(firstMoment + 1000, rows.reheld(read, rewrapped('first', 'kid-c'))),
    ];

    expect(reheld).toEqual([true, false]);
    expect(await rowsIn(entry, database)).toEqual([
      {
        id: 'secret-1',
        version: 1,
        kept_at: isoOf(firstMoment),
        claimed_until: isoOf(firstMoment + aLease),
        ends_with: '1234',
        kept_by: 'ledger',
        held: 'held-first',
        wrapped_key: 'rewrapped-first',
        kid: 'kid-b',
      },
    ]);
  });
}

function heldAgainOnlyAsRead(entry: SecretsEntry): void {
  it('hold nothing again of a row replaced or gone since it was read, and hold again a row whose holding has no wrapped key or kid', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first')));
    await Effect.runPromise(rows.keep('secret-4', heldElsewhere));
    const read = { id: 'secret-1', version: 1, holding: sealedHolding('first') };
    await Effect.runPromise(rows.replace('secret-1', 1, sealedHolding('first')));

    const reheld = [
      await Effect.runPromise(rows.reheld(read, rewrapped('first', 'kid-b'))),
      await Effect.runPromise(rows.reheld({ ...read, id: 'secret-2' }, rewrapped('first', 'kid-b'))),
      await Effect.runPromise(
        rows.reheld({ id: 'secret-4', version: 1, holding: heldElsewhere }, sealedHolding('fourth')),
      ),
    ];

    expect(reheld).toEqual([false, false, true]);
    expect(await Effect.runPromise(rows.heldBy({ keptBy: 'ledger' }, 100))).toEqual([
      { id: 'secret-1', version: 2, holding: sealedHolding('first') },
      { id: 'secret-4', version: 1, holding: sealedHolding('fourth') },
    ]);
  });
}

function heldElsewhereSince(entry: SecretsEntry): void {
  it('replace or hold again a sealed row with the holding of another keeper, leaving its wrapped key and kid empty', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first')));
    await Effect.runPromise(rows.keep('secret-2', sealedHolding('second')));

    const replaced = await Effect.runPromise(rows.replace('secret-1', 1, heldElsewhere));
    const reheld = await Effect.runPromise(
      rows.reheld({ id: 'secret-2', version: 1, holding: sealedHolding('second') }, heldElsewhere),
    );

    expect({ replaced, reheld }).toEqual({ replaced: { replaced: true, version: 2 }, reheld: true });
    expect(
      (await rowsIn(entry, database)).map(({ id, kept_by, wrapped_key, kid }) => [id, kept_by, wrapped_key, kid]),
    ).toEqual([
      ['secret-1', 'another-keeper', null, null],
      ['secret-2', 'another-keeper', null, null],
    ]);
  });
}

export function rowsHoldingBehaviour(entry: SecretsEntry): void {
  describe('the rows held for the start', () => {
    heldByAKeeper(entry);
    heldAgain(entry);
    heldAgainOnlyAsRead(entry);
    heldElsewhereSince(entry);
  });
}
