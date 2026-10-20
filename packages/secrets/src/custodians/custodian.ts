import type { Effect, Redacted } from 'effect';

export interface Custodian {
  readonly kid: string;
  readonly wrap: (dataKey: Redacted.Redacted<Uint8Array>) => Effect.Effect<string>;
  readonly unwrap: (wrapped: string) => Effect.Effect<Redacted.Redacted<Uint8Array>>;
}

export interface Custodians {
  readonly current: Custodian;
  readonly previous?: Custodian | undefined;
}

export function custodianNamed({ current, previous }: Custodians, kid: string): Custodian | undefined {
  return [current, previous].find((custodian) => custodian?.kid === kid);
}

export function anotherPrevious({ current, previous }: Custodians): Custodian | undefined {
  return previous?.kid === current.kid ? undefined : previous;
}
