import { Effect, Redacted } from 'effect';

import type { Claim, Holding, Replacement } from '../rows/secret-rows.ts';
import { memoryRows, type MemoryRowsOptions } from './memory-rows.ts';

export interface ValueRefused {
  readonly detail: string;
}

export interface ValueInTheClear {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export interface ValuesInTheClear {
  readonly keep: (id: string, value: Redacted.Redacted, endsWith?: string) => Effect.Effect<void, ValueRefused>;
  readonly read: (id: string) => Effect.Effect<ValueInTheClear | undefined>;
  readonly replace: (id: string, version: number, value: Redacted.Redacted) => Effect.Effect<Replacement, ValueRefused>;
  readonly claim: (id: string, version: number, lastingMs: number) => Effect.Effect<Claim>;
  readonly endingsOf: (ids: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>;
  readonly forget: (id: string) => Effect.Effect<void>;
  readonly values: () => ReadonlyMap<string, string>;
  readonly endings: () => ReadonlyMap<string, string>;
}

export interface ValuesInTheClearOptions extends MemoryRowsOptions {
  readonly mostCharacters: number;
}

const keptInMemory = 'memory';

export function valuesInTheClear({ now, mostCharacters }: ValuesInTheClearOptions): ValuesInTheClear {
  const rows = memoryRows({ now });
  const heldOr = <A>(
    value: Redacted.Redacted,
    held: (holding: Holding) => Effect.Effect<A>,
  ): Effect.Effect<A, ValueRefused> =>
    Effect.suspend(() => {
      const text = Redacted.value(value);
      return text.length > mostCharacters
        ? Effect.fail({ detail: `A secret to keep holds more than ${mostCharacters} characters` })
        : held({ keptBy: keptInMemory, held: text });
    });
  return {
    keep: (id, value, endsWith) => heldOr(value, (holding) => rows.keep(id, holding, endsWith)),
    read: (id) =>
      Effect.map(rows.read(id), (row) =>
        row === undefined
          ? undefined
          : { value: Redacted.make(row.holding.held), version: row.version, claimedUntil: row.claimedUntil },
      ),
    replace: (id, version, value) => heldOr(value, (holding) => rows.replace(id, version, holding)),
    claim: rows.claim,
    endingsOf: rows.endingsOf,
    forget: (id) => Effect.asVoid(rows.forget(id)),
    values: () => new Map(rows.kept().map(({ id, held }): readonly [string, string] => [id, held])),
    endings: () =>
      new Map(
        rows
          .kept()
          .flatMap(({ id, ends_with }): (readonly [string, string])[] => (ends_with === null ? [] : [[id, ends_with]])),
      ),
  };
}
