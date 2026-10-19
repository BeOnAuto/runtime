import { DateTime, Effect, Option, Redacted } from 'effect';

import type { KeptRow, TokensClaimed, TokensReplaced } from '../consent/consent-client.ts';

interface Row {
  readonly text: string;
  readonly version: number;
  readonly claimedUntil: number | undefined;
}

export interface LeasedRows {
  readonly keep: (value: Redacted.Redacted) => Effect.Effect<string, { readonly detail: string }>;
  readonly read: (id: string) => Effect.Effect<KeptRow | undefined>;
  readonly replace: (
    id: string,
    version: number,
    value: Redacted.Redacted,
  ) => Effect.Effect<TokensReplaced, { readonly detail: string }>;
  readonly claim: (id: string, version: number, lastingMs: number) => Effect.Effect<TokensClaimed>;
  readonly forget: (id: string) => Effect.Effect<void>;
  readonly values: () => ReadonlyMap<string, string>;
}

export interface Leasing {
  readonly now: Effect.Effect<number>;
  readonly mostCharacters: number;
}

function isoOf(moment: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(moment));
}

function openClaimOf(row: Row, moment: number): number | undefined {
  return row.claimedUntil !== undefined && row.claimedUntil > moment ? row.claimedUntil : undefined;
}

function keptRowOf(row: Row, moment: number): KeptRow {
  const until = openClaimOf(row, moment);
  return {
    value: Redacted.make(row.text),
    version: row.version,
    claimedUntil: until === undefined ? undefined : isoOf(until),
  };
}

function tooLarge({ mostCharacters }: Leasing) {
  return Effect.fail({ detail: `A secret to keep holds more than ${mostCharacters} characters` });
}

function claimed(rows: ReadonlyMap<string, Row>, id: string, version: number, moment: number): Row | undefined {
  const row = rows.get(id);
  return row?.version === version && openClaimOf(row, moment) === undefined ? row : undefined;
}

export function leasedRows(leasing: Leasing): LeasedRows {
  const rows = new Map<string, Row>();
  const { now, mostCharacters } = leasing;
  return {
    keep: (value) =>
      Effect.suspend(() => {
        const text = Redacted.value(value);
        if (text.length > mostCharacters) {
          return tooLarge(leasing);
        }
        const id = `secret-${rows.size + 1}`;
        rows.set(id, { text, version: 1, claimedUntil: undefined });
        return Effect.succeed(id);
      }),
    read: (id) =>
      Effect.map(now, (moment) =>
        Option.getOrUndefined(Option.map(Option.fromNullishOr(rows.get(id)), (row) => keptRowOf(row, moment))),
      ),
    replace: (id, version, value) =>
      Effect.suspend(() => {
        const text = Redacted.value(value);
        if (text.length > mostCharacters) {
          return tooLarge(leasing);
        }
        if (rows.get(id)?.version !== version) {
          return Effect.succeed<TokensReplaced>({ replaced: false });
        }
        rows.set(id, { text, version: version + 1, claimedUntil: undefined });
        return Effect.succeed<TokensReplaced>({ replaced: true, version: version + 1 });
      }),
    claim: (id, version, lastingMs) =>
      Effect.map(now, (moment): TokensClaimed => {
        const row = claimed(rows, id, version, moment);
        if (row === undefined) {
          return { claimed: false };
        }
        rows.set(id, { ...row, claimedUntil: moment + lastingMs });
        return { claimed: true, until: isoOf(moment + lastingMs) };
      }),
    forget: (id) =>
      Effect.sync(() => {
        rows.delete(id);
      }),
    values: () => new Map([...rows].map(([id, row]: readonly [string, Row]) => [id, row.text])),
  };
}
