import { describe, expect, it } from 'vitest';

import type { PeopleRows } from './people-rows.ts';

export interface PeopleRowsEntry {
  readonly name: string;
  readonly rowsOf: () => Promise<PeopleRows>;
}

const signedInAt = Date.parse('2026-11-18T09:00:00Z');

const anHour = 3_600_000;

const ada = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

const priya = '0c3de111680d66bea9b377080ec7d6784c7602c7bc2e4bfdd1b3ee489b0675ea';

function keepingBehaviour({ name, rowsOf }: PeopleRowsEntry): void {
  describe(`the people kept ${name}`, () => {
    it('keep each person by their id, with the name and the address their sign-in gave, in the order they joined', async () => {
      const rows = await rowsOf();

      await rows.kept({ person: priya, updatedAt: signedInAt + anHour });
      await rows.kept({ person: ada, name: 'Ada Lovelace', emailAddress: 'ada@example.com', updatedAt: signedInAt });

      expect(await rows.listed()).toEqual([
        {
          person: ada,
          name: 'Ada Lovelace',
          emailAddress: 'ada@example.com',
          joinedAt: signedInAt,
          updatedAt: signedInAt,
        },
        { person: priya, joinedAt: signedInAt + anHour, updatedAt: signedInAt + anHour },
      ]);
    });

    it('replace the name and the address at each later sign-in, one given no more leaving none, and keep when the person joined', async () => {
      const rows = await rowsOf();
      await rows.kept({ person: ada, name: 'Ada Lovelace', emailAddress: 'ada@example.com', updatedAt: signedInAt });

      await rows.kept({ person: ada, name: 'Ada King', updatedAt: signedInAt + anHour });

      expect(await rows.listed()).toEqual([
        { person: ada, name: 'Ada King', joinedAt: signedInAt, updatedAt: signedInAt + anHour },
      ]);
    });

    it('find one person by their id, and no one for an id never kept', async () => {
      const rows = await rowsOf();
      await rows.kept({ person: ada, name: 'Ada Lovelace', updatedAt: signedInAt });

      expect([await rows.found(ada), await rows.found(priya)]).toEqual([
        { person: ada, name: 'Ada Lovelace', joinedAt: signedInAt, updatedAt: signedInAt },
        undefined,
      ]);
    });
  });
}

function verifyingBehaviour({ name, rowsOf }: PeopleRowsEntry): void {
  describe(`the people kept ${name}, their addresses verified or not`, () => {
    it('keep whether the address of the last sign-in was verified, a later sign-in that does not say so leaving it unverified', async () => {
      const rows = await rowsOf();
      const signedIn = { person: ada, emailAddress: 'ada@example.com', updatedAt: signedInAt };
      await rows.kept({ ...signedIn, emailVerified: true });
      const verified = await rows.found(ada);

      await rows.kept({ ...signedIn, updatedAt: signedInAt + anHour });

      expect([verified, await rows.found(ada)]).toEqual([
        { ...signedIn, emailVerified: true, joinedAt: signedInAt },
        { ...signedIn, joinedAt: signedInAt, updatedAt: signedInAt + anHour },
      ]);
    });
  });
}

function findingBehaviour({ name, rowsOf }: PeopleRowsEntry): void {
  describe(`the people kept ${name}, found and forgotten`, () => {
    it('forget a person deleted, and no one else', async () => {
      const rows = await rowsOf();
      await rows.kept({ person: ada, updatedAt: signedInAt });
      await rows.kept({ person: priya, updatedAt: signedInAt });

      await rows.deleted(ada);
      await rows.deleted('a person never kept');

      expect(await rows.listed()).toEqual([{ person: priya, joinedAt: signedInAt, updatedAt: signedInAt }]);
    });
  });
}

export function peopleRowsBehaviour(entry: PeopleRowsEntry): void {
  keepingBehaviour(entry);
  verifyingBehaviour(entry);
  findingBehaviour(entry);
}
