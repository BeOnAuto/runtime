import { describe, expect, it } from 'vitest';

import type { SessionRow, SessionRows } from '../sessions/session-rows.ts';

export interface SessionRowsEntry {
  readonly name: string;
  readonly rowsOf: () => Promise<SessionRows>;
}

const createdAt = Date.parse('2026-11-18T09:00:00Z');

const aMinute = 60_000;

function rowOf(sha256: string, changes: Partial<SessionRow> = {}): SessionRow {
  return {
    sha256,
    issuer: 'https://login.example.com/tenant/v2.0',
    subject: 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4',
    createdAt,
    lastUsedAt: createdAt,
    expiresAt: createdAt + 10 * aMinute,
    ...changes,
  };
}

export function sessionRowsBehaviour({ name, rowsOf }: SessionRowsEntry): void {
  describe(`the sessions kept ${name}`, () => {
    it('find a row by its key until it expires, with the issuer and the subject as given', async () => {
      const rows = await rowsOf();
      await rows.kept(rowOf('sha256-1'));

      expect(await rows.found('sha256-1', createdAt + aMinute)).toEqual(rowOf('sha256-1'));
      expect(await rows.found('sha256-1', createdAt + 10 * aMinute)).toBeUndefined();
      expect(await rows.found('sha256-2', createdAt)).toBeUndefined();
    });

    it('keep the time of a use and the expiry it moves to', async () => {
      const rows = await rowsOf();
      await rows.kept(rowOf('sha256-1'));

      await rows.used({ sha256: 'sha256-1', lastUsedAt: createdAt + aMinute, expiresAt: createdAt + 20 * aMinute });
      await rows.used({ sha256: 'sha256-2', lastUsedAt: createdAt + aMinute, expiresAt: createdAt + 20 * aMinute });

      expect(await rows.found('sha256-1', createdAt + 15 * aMinute)).toEqual(
        rowOf('sha256-1', { lastUsedAt: createdAt + aMinute, expiresAt: createdAt + 20 * aMinute }),
      );
      expect(await rows.found('sha256-2', createdAt)).toBeUndefined();
    });

    it('forget a row once it is ended, and every row that has expired once another is kept', async () => {
      const rows = await rowsOf();
      await rows.kept(rowOf('sha256-1'));
      await rows.kept(rowOf('sha256-2'));

      await rows.ended('sha256-1');
      await rows.kept(rowOf('sha256-3', { createdAt: createdAt + 10 * aMinute, expiresAt: createdAt + 20 * aMinute }));
      await rows.used({
        sha256: 'sha256-2',
        lastUsedAt: createdAt + 11 * aMinute,
        expiresAt: createdAt + 30 * aMinute,
      });

      expect(await rows.found('sha256-1', createdAt)).toBeUndefined();
      expect(await rows.found('sha256-2', createdAt + 11 * aMinute)).toBeUndefined();
      expect(await rows.found('sha256-3', createdAt + 11 * aMinute)).toEqual(
        rowOf('sha256-3', { createdAt: createdAt + 10 * aMinute, expiresAt: createdAt + 20 * aMinute }),
      );
    });
  });
}
