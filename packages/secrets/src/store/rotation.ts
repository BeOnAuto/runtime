import { Effect } from 'effect';

import { anotherPrevious, type Custodian, type Custodians } from '../custodians/custodian.ts';
import { zeroedAfter } from '../keepers/data-key.ts';
import type { KeepingFailure } from '../keepers/keeper.ts';
import { ledgerKeeper } from '../keepers/sealed-keeper.ts';
import type { HeldRow, SecretRows } from '../rows/secret-rows.ts';
import { answeredWithinItsBound } from './answer-bound.ts';

const rowsInABatch = 100;

interface Rotation {
  readonly current: Custodian;
  readonly previous: Custodian;
}

function rewrapped(
  rows: SecretRows,
  { current, previous }: Rotation,
  read: HeldRow,
): Effect.Effect<boolean, KeepingFailure> {
  return Effect.gen(function* () {
    const { wrappedKey = '' } = read.holding;
    const rewrapping = yield* answeredWithinItsBound(
      Effect.flatMap(previous.unwrap(wrappedKey), (dataKey) => zeroedAfter(dataKey, current.wrap(dataKey))),
    );
    return yield* rows.reheld(read, { ...read.holding, wrappedKey: rewrapping, kid: current.kid });
  });
}

function rewrappedInBatches(
  rows: SecretRows,
  rotation: Rotation,
  before: number,
): Effect.Effect<number, KeepingFailure> {
  return Effect.gen(function* () {
    const held = yield* rows.heldBy({ keptBy: ledgerKeeper, kid: rotation.previous.kid }, rowsInABatch);
    const reheld = yield* Effect.forEach(held, (read) => rewrapped(rows, rotation, read));
    const count = before + reheld.filter(Boolean).length;
    return held.length < rowsInABatch ? count : yield* rewrappedInBatches(rows, rotation, count);
  });
}

export function rotatedOn(rows: SecretRows, custodians: Custodians): Effect.Effect<number, KeepingFailure> {
  const previous = anotherPrevious(custodians);
  return previous === undefined
    ? Effect.succeed(0)
    : rewrappedInBatches(rows, { current: custodians.current, previous }, 0);
}
