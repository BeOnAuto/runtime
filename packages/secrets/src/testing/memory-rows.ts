import { DateTime, Effect } from 'effect';

import type { Claim, HeldRow, Holder, Holding, Replacement, SecretRow, SecretRows } from '../rows/secret-rows.ts';

export interface KeptColumns {
  readonly id: string;
  readonly version: number;
  readonly kept_at: string;
  readonly claimed_until: string | null;
  readonly ends_with: string | null;
  readonly kept_by: string;
  readonly held: string;
  readonly wrapped_key: string | null;
  readonly kid: string | null;
}

export interface MemoryRows extends SecretRows {
  readonly kept: () => readonly KeptColumns[];
}

export interface MemoryRowsOptions {
  readonly now: Effect.Effect<number>;
}

interface Row {
  readonly id: string;
  readonly version: number;
  readonly keptAt: number;
  readonly claimedUntil: number | undefined;
  readonly endsWith: string | undefined;
  readonly holding: Holding;
}

interface Table {
  readonly row: (id: string) => Row | undefined;
  readonly put: (row: Row) => void;
  readonly drop: (id: string) => void;
  readonly inOrder: () => readonly Row[];
}

interface Asked {
  readonly id: string;
  readonly version: number;
}

function tableOf(): Table {
  const rows = new Map<string, Row>();
  return {
    row: (id) => rows.get(id),
    put: (row) => {
      rows.set(row.id, row);
    },
    drop: (id) => {
      rows.delete(id);
    },
    inOrder: () => [...rows.values()].toSorted((first, second) => first.id.localeCompare(second.id)),
  };
}

function isoOf(moment: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(moment));
}

function openClaimOf({ claimedUntil }: Row, moment: number): number | undefined {
  return claimedUntil !== undefined && claimedUntil > moment ? claimedUntil : undefined;
}

function secretRowOf(row: Row, moment: number): SecretRow {
  const until = openClaimOf(row, moment);
  return { holding: row.holding, version: row.version, claimedUntil: until === undefined ? undefined : isoOf(until) };
}

function columnsOf({ id, version, keptAt, claimedUntil, endsWith, holding }: Row): KeptColumns {
  return {
    id,
    version,
    kept_at: isoOf(keptAt),
    claimed_until: claimedUntil === undefined ? null : isoOf(claimedUntil),
    ends_with: endsWith ?? null,
    kept_by: holding.keptBy,
    held: holding.held,
    wrapped_key: holding.wrappedKey ?? null,
    kid: holding.kid ?? null,
  };
}

function sameHolding(first: Holding, second: Holding): boolean {
  return (
    first.keptBy === second.keptBy &&
    first.held === second.held &&
    first.wrappedKey === second.wrappedKey &&
    first.kid === second.kid
  );
}

function keptIn(table: Table, moment: number, row: Omit<Row, 'keptAt'>): Effect.Effect<void> {
  if (table.row(row.id) !== undefined) {
    return Effect.die(new Error(`A row is kept under the id ${row.id} already`));
  }
  table.put({ ...row, keptAt: moment });
  return Effect.void;
}

function replacedIn(table: Table, moment: number, { id, version }: Asked, holding: Holding): Replacement {
  if (table.row(id)?.version !== version) {
    return { replaced: false };
  }
  table.put({ id, version: version + 1, keptAt: moment, claimedUntil: undefined, endsWith: undefined, holding });
  return { replaced: true, version: version + 1 };
}

function claimedIn(table: Table, moment: number, { id, version }: Asked, lastingMs: number): Claim {
  const row = table.row(id);
  if (row?.version !== version || openClaimOf(row, moment) !== undefined) {
    return { claimed: false };
  }
  table.put({ ...row, claimedUntil: moment + lastingMs });
  return { claimed: true, until: isoOf(moment + lastingMs) };
}

function endingsIn(table: Table, ids: readonly string[]): ReadonlyMap<string, string> {
  return new Map(
    table
      .inOrder()
      .filter(({ id }) => ids.includes(id))
      .flatMap(({ id, endsWith }): (readonly [string, string])[] => (endsWith === undefined ? [] : [[id, endsWith]])),
  );
}

function forgottenIn(table: Table, id: string): Holding | undefined {
  const holding = table.row(id)?.holding;
  table.drop(id);
  return holding;
}

interface Held {
  readonly limit: number;
  readonly after: string | undefined;
}

function isHeldBy({ keptBy, kid }: Holder, { holding }: Row): boolean {
  return holding.keptBy === keptBy && (kid === undefined || holding.kid === kid);
}

function heldIn(table: Table, holder: Holder, { limit, after }: Held): readonly HeldRow[] {
  return table
    .inOrder()
    .filter((row) => isHeldBy(holder, row) && (after === undefined || row.id.localeCompare(after) > 0))
    .slice(0, limit)
    .map(({ id, version, holding }) => ({ id, version, holding }));
}

function reheldIn(table: Table, read: HeldRow, holding: Holding): boolean {
  const row = table.row(read.id);
  if (row?.version !== read.version || !sameHolding(row.holding, read.holding)) {
    return false;
  }
  table.put({ ...row, holding });
  return true;
}

export function memoryRows({ now }: MemoryRowsOptions): MemoryRows {
  const table = tableOf();
  return {
    keep: (id, holding, endsWith) =>
      Effect.flatMap(now, (moment) =>
        keptIn(table, moment, { id, version: 1, claimedUntil: undefined, endsWith, holding }),
      ),
    read: (id) =>
      Effect.map(now, (moment) => {
        const row = table.row(id);
        return row === undefined ? undefined : secretRowOf(row, moment);
      }),
    replace: (id, version, holding) => Effect.map(now, (moment) => replacedIn(table, moment, { id, version }, holding)),
    claim: (id, version, lastingMs) =>
      Effect.map(now, (moment) => claimedIn(table, moment, { id, version }, lastingMs)),
    endingsOf: (ids) => Effect.sync(() => endingsIn(table, ids)),
    forget: (id) => Effect.sync(() => forgottenIn(table, id)),
    heldBy: (holder, limit, after) => Effect.sync(() => heldIn(table, holder, { limit, after })),
    reheld: (read, holding) => Effect.sync(() => reheldIn(table, read, holding)),
    close: () => Promise.resolve(),
    kept: () => table.inOrder().map((row) => columnsOf(row)),
  };
}
