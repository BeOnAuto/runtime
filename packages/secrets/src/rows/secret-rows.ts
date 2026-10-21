import type { Effect } from 'effect';

export interface Holding {
  readonly keptBy: string;
  readonly held: string;
  readonly wrappedKey?: string | undefined;
  readonly kid?: string | undefined;
}

export interface SecretRow {
  readonly holding: Holding;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export interface HeldRow {
  readonly id: string;
  readonly version: number;
  readonly holding: Holding;
}

export interface Holder {
  readonly keptBy: string;
  readonly kid?: string | undefined;
}

export type Replacement = { readonly replaced: true; readonly version: number } | { readonly replaced: false };

export type Claim = { readonly claimed: true; readonly until: string } | { readonly claimed: false };

export interface SecretRows {
  readonly keep: (id: string, holding: Holding, endsWith?: string) => Effect.Effect<void>;
  readonly read: (id: string) => Effect.Effect<SecretRow | undefined>;
  readonly replace: (id: string, version: number, holding: Holding) => Effect.Effect<Replacement>;
  readonly claim: (id: string, version: number, lastingMs: number) => Effect.Effect<Claim>;
  readonly endingsOf: (ids: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>;
  readonly forget: (id: string) => Effect.Effect<Holding | undefined>;
  readonly heldBy: (holder: Holder, limit: number, after?: string) => Effect.Effect<readonly HeldRow[]>;
  readonly reheld: (read: HeldRow, holding: Holding) => Effect.Effect<boolean>;
  readonly close: () => Promise<void>;
}
