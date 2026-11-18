import type { SessionRow, SessionRows } from '../sessions/session-rows.ts';

export function sessionRowsInMemory(): SessionRows {
  const rows = new Map<string, SessionRow>();
  const expiredBy = (now: number): void => {
    for (const [sha256, row] of rows) {
      if (row.expiresAt <= now) {
        rows.delete(sha256);
      }
    }
  };
  return {
    kept: (row) => {
      expiredBy(row.createdAt);
      rows.set(row.sha256, row);
      return Promise.resolve();
    },
    found: (sha256, now) => {
      const row = rows.get(sha256);
      return Promise.resolve(row !== undefined && row.expiresAt > now ? row : undefined);
    },
    used: ({ sha256, lastUsedAt, expiresAt }) => {
      const row = rows.get(sha256);
      if (row !== undefined) {
        rows.set(sha256, { ...row, lastUsedAt, expiresAt });
      }
      return Promise.resolve();
    },
    ended: (sha256) => {
      rows.delete(sha256);
      return Promise.resolve();
    },
  };
}
