import { DateTime, Effect, Function, Option, Redacted } from 'effect';

import type { Timer } from '../clients/http-client.ts';
import { keptTokensOf, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import type {
  ChosenClient,
  ConnectionTokens,
  ConsentServed,
  ConsentWay,
  HeldTokens,
  TokensClaimed,
  TokensEnded,
  TokensReplaced,
} from '../consent/consent-client.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { everyHost, returnAddress } from './consent-fakes.ts';

interface Row {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: number | undefined;
}

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

function isoOf(moment: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(moment));
}

function openClaimOf(row: Row, now: number): number | undefined {
  return row.claimedUntil !== undefined && row.claimedUntil > now ? row.claimedUntil : undefined;
}

export function brokenWords(ended: TokensEnded): string {
  return `The connection is broken: ${ended}`;
}

export const goneWords = 'The tokens of the connection are no longer in the secret store';

interface Stored {
  readonly row: () => Row | undefined;
  readonly keep: (row: Row | undefined) => void;
}

function readOf(stored: Stored, now: () => number): ConnectionTokens['read'] {
  return Effect.suspend(() => {
    const row = stored.row();
    if (row === undefined) {
      return Effect.fail({ because: 'connection_broken', detail: goneWords });
    }
    const until = openClaimOf(row, now());
    return Effect.succeed<HeldTokens>({
      value: row.value,
      version: row.version,
      claimedUntil: until === undefined ? undefined : isoOf(until),
    });
  });
}

function replaceOf(stored: Stored, mostCharacters: number): ConnectionTokens['replace'] {
  return (version, replacing) =>
    Effect.suspend(() => {
      if (Redacted.value(replacing).length > mostCharacters) {
        return Effect.fail({ detail: `A secret to keep holds more than ${mostCharacters} characters` });
      }
      if (stored.row()?.version !== version) {
        return Effect.succeed<TokensReplaced>({ replaced: false });
      }
      stored.keep({ value: replacing, version: version + 1, claimedUntil: undefined });
      return Effect.succeed<TokensReplaced>({ replaced: true, version: version + 1 });
    });
}

function claimOf(stored: Stored, now: () => number): ConnectionTokens['claim'] {
  return (version, lastingMs) =>
    Effect.sync((): TokensClaimed => {
      const row = stored.row();
      if (row?.version !== version || openClaimOf(row, now()) !== undefined) {
        return { claimed: false };
      }
      const until = now() + lastingMs;
      stored.keep({ ...row, claimedUntil: until });
      return { claimed: true, until: isoOf(until) };
    });
}

export function memoryTokens(value: Redacted.Redacted, { now, mostCharacters = 8192 }: MemoryTokensOptions) {
  const held: { row: Row | undefined } = { row: { value, version: 1, claimedUntil: undefined } };
  const claims: number[] = [];
  const ends: TokensEnded[] = [];
  const stored: Stored = {
    row: () => held.row,
    keep: (row) => {
      held.row = row;
    },
  };
  const claiming = claimOf(stored, now);
  const tokens: MemoryTokens = {
    read: readOf(stored, now),
    replace: replaceOf(stored, mostCharacters),
    claim: (version, lastingMs) => {
      claims.push(lastingMs);
      return claiming(version, lastingMs);
    },
    broken: (ended) =>
      Effect.suspend(() => {
        ends.push(ended);
        return Effect.fail({ because: 'connection_broken', detail: brokenWords(ended) });
      }),
    kept: () => Option.getOrUndefined(Option.map(Option.fromNullishOr(held.row), (row) => keptTokensOf(row.value))),
    version: () => held.row?.version,
    claims: () => [...claims],
    ends: () => [...ends],
    forget: () => {
      held.row = undefined;
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
