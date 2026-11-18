import { randomBytes } from 'node:crypto';

import { sha256Of } from '@on.auto/content';

import type { SignedInPerson } from '../provider/relying-party.ts';
import type { SessionRow, SessionRows } from './session-rows.ts';

const aMinute = 60_000;

const aDay = 1440 * aMinute;

export const mostUnusedMs = 7 * aDay;

export const mostLifetimeMs = 30 * aDay;

const usesRecordedAtMostEveryMs = 10 * aMinute;

const identifierBytes = 32;

export interface Sessions {
  readonly begun: (person: SignedInPerson) => Promise<string>;
  readonly personOf: (identifier: string) => Promise<SignedInPerson | undefined>;
  readonly ended: (identifier: string) => Promise<void>;
}

function expiryOf(createdAt: number, lastUsedAt: number): number {
  return Math.min(lastUsedAt + mostUnusedMs, createdAt + mostLifetimeMs);
}

async function usedAt(
  rows: SessionRows,
  { sha256, issuer, subject, createdAt, lastUsedAt }: SessionRow,
  at: number,
): Promise<SignedInPerson> {
  if (at - lastUsedAt >= usesRecordedAtMostEveryMs) {
    await rows.used({ sha256, lastUsedAt: at, expiresAt: expiryOf(createdAt, at) });
  }
  return { issuer, subject };
}

export function sessionsOf(rows: SessionRows, now: () => number = Date.now): Sessions {
  return {
    begun: async ({ issuer, subject }) => {
      const identifier = randomBytes(identifierBytes).toString('base64url');
      const at = now();
      await rows.kept({
        sha256: sha256Of(identifier),
        issuer,
        subject,
        createdAt: at,
        lastUsedAt: at,
        expiresAt: expiryOf(at, at),
      });
      return identifier;
    },
    personOf: async (identifier) => {
      const at = now();
      const row = await rows.found(sha256Of(identifier), at);
      return row === undefined ? row : usedAt(rows, row, at);
    },
    ended: (identifier) => rows.ended(sha256Of(identifier)),
  };
}
