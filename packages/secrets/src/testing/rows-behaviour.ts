import { Cause, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { heldElsewhere, sealedHolding } from './holdings.ts';
import { rowsHoldingBehaviour } from './rows-holding-behaviour.ts';
import { aLease, at, firstMoment, isoOf, rowsIn, rowsOpenedOn, type SecretsEntry } from './secrets-entry.ts';

function keptAtItsFirstVersion(entry: SecretsEntry): void {
  it('keep a holding under the id they are given, at its first version, when it was kept, and read it back with no claim', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);

    await at(firstMoment, rows.keep('secret-1', sealedHolding('first'), '1234'));

    expect(await Effect.runPromise(rows.read('secret-1'))).toEqual({
      holding: sealedHolding('first'),
      version: 1,
      claimedUntil: undefined,
    });
    expect(await rowsIn(entry, database)).toEqual([
      {
        id: 'secret-1',
        version: 1,
        kept_at: isoOf(firstMoment),
        claimed_until: null,
        ends_with: '1234',
        kept_by: 'ledger',
        held: 'held-first',
        wrapped_key: 'wrapped-first',
        kid: 'kid-a',
      },
    ]);
  });
}

function keptElsewhere(entry: SecretsEntry): void {
  it('keep a holding without a wrapped key or a kid, as a keeper other than the ledger hands one back, and no ending', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);

    await Effect.runPromise(rows.keep('secret-4', heldElsewhere));

    expect(await Effect.runPromise(rows.read('secret-4'))).toEqual({
      holding: heldElsewhere,
      version: 1,
      claimedUntil: undefined,
    });
    expect(await rowsIn(entry, database)).toMatchObject([
      { kept_by: 'another-keeper', held: 'secret-4:1', wrapped_key: null, kid: null, ends_with: null },
    ]);
  });
}

function keptOnce(entry: SecretsEntry): void {
  it('keep no second row under an id they keep, failing as a defect and leaving the first as it was', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first'), '1234'));

    const cause = await Effect.runPromise(
      rows.keep('secret-1', sealedHolding('second')).pipe(Effect.sandbox, Effect.flip),
    );

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(await rowsIn(entry, database)).toEqual([
      expect.objectContaining({ id: 'secret-1', version: 1, held: 'held-first', ends_with: '1234' }),
    ]);
  });
}

function forgotten(entry: SecretsEntry): void {
  it('answer nothing for an id they do not keep, and forget a row, answering the holding it held, twice as once', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first'), '1234'));

    const answers = [
      await Effect.runPromise(rows.forget('secret-1')),
      await Effect.runPromise(rows.forget('secret-1')),
    ];

    expect(answers).toEqual([sealedHolding('first'), undefined]);
    expect(await Effect.runPromise(rows.read('secret-1'))).toBeUndefined();
    expect(await Effect.runPromise(rows.read('secret-2'))).toBeUndefined();
    expect(await Effect.runPromise(rows.endingsOf(['secret-1']))).toEqual(new Map());
    expect(await rowsIn(entry, database)).toEqual([]);
  });
}

function endings(entry: SecretsEntry): void {
  it('answer the ending of each id that has one, and nothing for no ids', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first'), '1234'));
    await Effect.runPromise(rows.keep('secret-2', sealedHolding('second')));

    expect(await Effect.runPromise(rows.endingsOf(['secret-1', 'secret-2', 'secret-3']))).toEqual(
      new Map([['secret-1', '1234']]),
    );
    expect(await Effect.runPromise(rows.endingsOf([]))).toEqual(new Map());
  });
}

function replacedAtTheVersionRead(entry: SecretsEntry): void {
  it('replace the holding of a row whose version is the one read, at the next version, kept when replaced, ending its claim and its ending, so the next version may be claimed at once', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await at(firstMoment, rows.keep('secret-1', sealedHolding('first'), '1234'));
    await at(firstMoment, rows.claim('secret-1', 1, aLease));

    const replaced = await at(firstMoment + 1000, rows.replace('secret-1', 1, sealedHolding('second', 'kid-b')));

    expect(replaced).toEqual({ replaced: true, version: 2 });
    expect(await at(firstMoment + 1000, rows.read('secret-1'))).toEqual({
      holding: sealedHolding('second', 'kid-b'),
      version: 2,
      claimedUntil: undefined,
    });
    expect(await rowsIn(entry, database)).toEqual([
      expect.objectContaining({ version: 2, kept_at: isoOf(firstMoment + 1000), claimed_until: null, ends_with: null }),
    ]);
    expect(await at(firstMoment + 1000, rows.claim('secret-1', 2, aLease))).toEqual({
      claimed: true,
      until: isoOf(firstMoment + 1000 + aLease),
    });
  });
}

function replacedNothing(entry: SecretsEntry): void {
  it('replace nothing of a row whose version moved or that is gone, and say so', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first')));

    const answers = [
      await Effect.runPromise(rows.replace('secret-1', 1, sealedHolding('second'))),
      await Effect.runPromise(rows.replace('secret-1', 1, sealedHolding('other'))),
      await Effect.runPromise(rows.replace('secret-2', 1, sealedHolding('other'))),
    ];

    expect(answers).toEqual([{ replaced: true, version: 2 }, { replaced: false }, { replaced: false }]);
    expect(await Effect.runPromise(rows.read('secret-1'))).toMatchObject({ holding: sealedHolding('second') });
  });
}

function claimedUntilATime(entry: SecretsEntry): void {
  it('claim a row of the version read until a time, which a read answers while the claim is open', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first')));

    const claim = await at(firstMoment, rows.claim('secret-1', 1, aLease));

    expect(claim).toEqual({ claimed: true, until: isoOf(firstMoment + aLease) });
    expect(await at(firstMoment + aLease - 1, rows.read('secret-1'))).toMatchObject({
      claimedUntil: isoOf(firstMoment + aLease),
    });
    expect(await at(firstMoment + aLease, rows.read('secret-1'))).toMatchObject({ claimedUntil: undefined });
  });
}

function claimedNothing(entry: SecretsEntry): void {
  it('claim nothing while a claim is open, of a version that moved or of a row that is gone, and again once a claim ended', async () => {
    const database = await entry.aDatabase();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-1', sealedHolding('first')));

    const claims = [
      await at(firstMoment, rows.claim('secret-1', 1, aLease)),
      await at(firstMoment + aLease - 1, rows.claim('secret-1', 1, aLease)),
      await at(firstMoment + aLease, rows.claim('secret-1', 2, aLease)),
      await at(firstMoment + aLease, rows.claim('secret-1', 1, aLease)),
      await at(firstMoment + aLease, rows.claim('secret-2', 1, aLease)),
    ];

    expect(claims).toEqual([
      { claimed: true, until: isoOf(firstMoment + aLease) },
      { claimed: false },
      { claimed: false },
      { claimed: true, until: isoOf(firstMoment + 2 * aLease) },
      { claimed: false },
    ]);
  });
}

export function rowsBehaviour(entry: SecretsEntry): void {
  describe('the rows of the secret store', () => {
    keptAtItsFirstVersion(entry);
    keptElsewhere(entry);
    keptOnce(entry);
    forgotten(entry);
    endings(entry);
    replacedAtTheVersionRead(entry);
    replacedNothing(entry);
    claimedUntilATime(entry);
    claimedNothing(entry);
    rowsHoldingBehaviour(entry);
  });
}
