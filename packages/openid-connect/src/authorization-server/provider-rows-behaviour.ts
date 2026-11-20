import { describe, expect, it } from 'vitest';

import type { ProviderRow, ProviderRows } from './provider-rows.ts';

export interface ProviderRowsEntry {
  readonly name: string;
  readonly rowsOf: () => Promise<ProviderRows>;
}

const keptAt = Date.parse('2026-11-19T09:00:00Z');

function rowOf(model: string, sha256: string, changes: Partial<ProviderRow> = {}): ProviderRow {
  return {
    model,
    sha256,
    payload: `{"kind":"${model}"}`,
    grantId: 'grant-1',
    uid: undefined,
    expiresAt: keptAt + 60_000,
    ...changes,
  };
}

function storedOf({ payload, grantId }: ProviderRow, consumedAt?: number) {
  return { payload, grantId, consumedAt };
}

function findingBehaviour({ name, rowsOf }: ProviderRowsEntry): void {
  describe(`the rows of the authorization server ${name}, as they are found`, () => {
    it('find a row by its model and key, and replace it when it is kept again', async () => {
      const rows = await rowsOf();
      const token = rowOf('AccessToken', 'sha256-1');
      await rows.kept(token);
      await rows.kept(rowOf('RefreshToken', 'sha256-1'));
      const replaced = { ...token, payload: '{"kind":"AccessToken","scope":"org:read"}', grantId: undefined };
      await rows.kept(replaced);

      expect(await rows.found(token)).toEqual(storedOf(replaced));
      expect(await rows.found({ model: 'AccessToken', sha256: 'sha256-2' })).toBeUndefined();
      expect(await rows.found({ model: 'RefreshToken', sha256: 'sha256-1' })).toEqual(
        storedOf(rowOf('RefreshToken', 'sha256-1')),
      );
    });

    it('find a session by its uid', async () => {
      const rows = await rowsOf();
      const session = rowOf('Session', 'sha256-3', { uid: 'uid-1', grantId: undefined });
      await rows.kept(session);

      expect(await rows.foundByUid('Session', 'uid-1')).toEqual(storedOf(session));
      expect(await rows.foundByUid('Session', 'uid-2')).toBeUndefined();
    });
  });
}

function endingBehaviour({ name, rowsOf }: ProviderRowsEntry): void {
  describe(`the rows of the authorization server ${name}, as they end`, () => {
    it('consume a row once, and answer that it was consumed already the second time', async () => {
      const rows = await rowsOf();
      const code = rowOf('AuthorizationCode', 'sha256-4');
      await rows.kept(code);

      const consumed = await Promise.all([rows.consumed(code, keptAt), rows.consumed(code, keptAt + 1)]);

      expect(consumed.toSorted()).toEqual([false, true]);
      expect((await rows.found(code))?.consumedAt).toBeOneOf([keptAt, keptAt + 1]);
      expect(await rows.consumed({ model: 'AuthorizationCode', sha256: 'sha256-5' }, keptAt)).toBe(false);
    });

    it('destroy one row, every row of a model that names a grant, and every row that ended before a time', async () => {
      const rows = await rowsOf();
      const kept = [
        rowOf('AccessToken', 'sha256-6'),
        rowOf('RefreshToken', 'sha256-7'),
        rowOf('AccessToken', 'sha256-8', { grantId: 'grant-2' }),
        rowOf('Client', 'sha256-9', { grantId: undefined, expiresAt: undefined }),
        rowOf('Interaction', 'sha256-10', { grantId: undefined, expiresAt: keptAt }),
      ];
      await Promise.all(kept.map((row) => rows.kept(row)));

      await rows.revokedByGrant('AccessToken', 'grant-1');
      await rows.destroyed(rowOf('AccessToken', 'sha256-8'));
      await rows.swept(keptAt);

      const found = await Promise.all(kept.map((row) => rows.found(row)));
      expect(found.map((row) => row !== undefined)).toEqual([false, true, false, true, false]);
    });
  });
}

function signingOutBehaviour({ name, rowsOf }: ProviderRowsEntry): void {
  describe(`the rows of the authorization server ${name}, as everyone is signed out`, () => {
    it('end every row of the models named at once, and keep every row of any other', async () => {
      const rows = await rowsOf();
      const kept = [
        rowOf('Session', 'sha256-11', { grantId: undefined }),
        rowOf('Grant', 'sha256-12', { grantId: undefined }),
        rowOf('RefreshToken', 'sha256-13'),
        rowOf('Client', 'sha256-14', { grantId: undefined, expiresAt: undefined }),
      ];
      await Promise.all(kept.map((row) => rows.kept(row)));

      await rows.endedEvery(['Session', 'Grant', 'RefreshToken']);

      const found = await Promise.all(kept.map((row) => rows.found(row)));
      expect(found.map((row) => row !== undefined)).toEqual([false, false, false, true]);
    });
  });
}

export function providerRowsBehaviour(entry: ProviderRowsEntry): void {
  signingOutBehaviour(entry);
  findingBehaviour(entry);
  endingBehaviour(entry);
}
