import { valuesInTheClear, type ValueInTheClear } from '@on.auto/secrets/testing';
import { Effect, Function, Option, type Redacted } from 'effect';

import type { Timer } from '../clients/http-client.ts';
import { keptTokensIn, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import type {
  ChosenClient,
  ConnectionTokens,
  ConsentServed,
  ConsentWay,
  TokensEnded,
} from '../consent/consent-client.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { everyHost, returnAddress } from './consent-fakes.ts';

export interface MemoryTokens extends ConnectionTokens {
  readonly kept: () => KeptTokens | undefined;
  readonly version: () => number | undefined;
  readonly claims: () => readonly number[];
  readonly ends: () => readonly TokensEnded[];
  readonly forget: () => void;
}

export interface MemoryTokensOptions {
  readonly now: () => number;
  readonly mostCharacters?: number;
}

export function brokenWords(ended: TokensEnded): string {
  return `The connection is broken: ${ended}`;
}

export const goneWords = 'The tokens of the connection are no longer in the secret store';

const row = 'secret-1';

function decoded({ value }: ValueInTheClear): KeptTokens {
  return Option.getOrThrow(keptTokensIn(value));
}

export function memoryTokens(value: Redacted.Redacted, { now, mostCharacters = 8192 }: MemoryTokensOptions) {
  const rows = valuesInTheClear({ now: Effect.sync(now), mostCharacters });
  Effect.runSync(Effect.orDie(rows.keep(row, value)));
  const claims: number[] = [];
  const ends: TokensEnded[] = [];
  const tokens: MemoryTokens = {
    read: Effect.flatMap(rows.read(row), (kept) =>
      kept === undefined
        ? Effect.fail({ because: 'connection_broken', detail: goneWords })
        : Effect.succeed({ tokens: decoded(kept), version: kept.version, claimedUntil: kept.claimedUntil }),
    ),
    replace: (version, replacing) => rows.replace(row, version, replacing),
    claim: (version, lastingMs) => {
      claims.push(lastingMs);
      return rows.claim(row, version, lastingMs);
    },
    broken: (ended) =>
      Effect.suspend(() => {
        ends.push(ended);
        return Effect.fail({ because: 'connection_broken', detail: brokenWords(ended) });
      }),
    kept: () => Option.getOrUndefined(Option.map(Option.fromNullishOr(Effect.runSync(rows.read(row))), decoded)),
    version: () => Effect.runSync(rows.read(row))?.version,
    claims: () => [...claims],
    ends: () => [...ends],
    forget: () => {
      Effect.runSync(rows.forget(row));
    },
  };
  return tokens;
}

export function servedAt(
  fake: FakeMcpServer,
  client: ChosenClient,
  tokens: MemoryTokens,
  way: Partial<ConsentWay> = {},
): Effect.Effect<ConsentServed> {
  return Effect.map(Effect.orDie(tokens.read), (held) => ({
    server: { type: 'mcp', url: fake.url },
    way: { issuer: fake.origin, scope: 'files.read', ...way },
    returnAddress,
    reaches: everyHost,
    client,
    held,
    tokens,
  }));
}

export interface ManualTimer {
  readonly timer: Timer;
  readonly waits: () => readonly number[];
  readonly fire: () => void;
}

export function manualTimer(): ManualTimer {
  const waits: number[] = [];
  const due: (() => void)[] = [];
  return {
    timer: {
      after: (ms, expire) => {
        waits.push(ms);
        due.push(expire);
        return Function.constVoid;
      },
    },
    waits: () => [...waits],
    fire: () => {
      for (const expire of due.splice(0)) {
        expire();
      }
    },
  };
}
