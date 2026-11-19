import { describe, expect, it } from 'vitest';

import type { SigningKeyRows } from './signing-key-rows.ts';

export interface SigningKeyRowsEntry {
  readonly name: string;
  readonly rowsOf: () => Promise<SigningKeyRows>;
}

const keptAt = Date.parse('2026-11-19T09:00:00Z');

export function signingKeyRowsBehaviour({ name, rowsOf }: SigningKeyRowsEntry): void {
  describe(`the signing key's row ${name}`, () => {
    it('names no key until one is kept, and keeps the first of two kept at once', async () => {
      const rows = await rowsOf();
      const before = await rows.found();

      const kept = await Promise.all([rows.kept('secret-1', keptAt), rows.kept('secret-2', keptAt)]);
      const winner = ['secret-1', 'secret-2'].filter((_, index) => kept[index] === true);

      expect(before).toBeUndefined();
      expect(winner).toHaveLength(1);
      expect([await rows.found()]).toEqual(winner);
    });

    it('replaces the key it names only while it still names the one replaced, so of two that replace it at once one does', async () => {
      const rows = await rowsOf();
      await rows.kept('secret-lost', keptAt);

      const replaced = await Promise.all([
        rows.replaced('secret-1', keptAt, 'secret-lost'),
        rows.replaced('secret-2', keptAt, 'secret-lost'),
      ]);
      const winner = ['secret-1', 'secret-2'].filter((_, index) => replaced[index] === true);

      expect(winner).toHaveLength(1);
      expect([await rows.found()]).toEqual(winner);
      expect(await rows.replaced('secret-3', keptAt, 'secret-lost')).toBe(false);
    });
  });
}
