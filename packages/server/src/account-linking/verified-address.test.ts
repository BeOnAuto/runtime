import type { PersonRow } from '@on.auto/openid-connect';
import { describe, expect, it } from 'vitest';

import { personOfAVerifiedAddress } from './verified-address.ts';

const signedInAt = Date.parse('2026-11-21T09:00:00Z');

function aPerson(person: string, emailAddress: string, verified = true): PersonRow {
  return {
    person,
    emailAddress,
    ...(verified ? { emailVerified: true } : {}),
    joinedAt: signedInAt,
    updatedAt: signedInAt,
  };
}

function matchOver(people: readonly PersonRow[], holding: readonly string[]) {
  const asked: string[] = [];
  const match = personOfAVerifiedAddress(
    { listed: () => Promise.resolve(people) },
    {
      holdsARole: (person) => {
        asked.push(person);
        return Promise.resolve(holding.includes(person));
      },
    },
  );
  return { match, asked };
}

const ada = aPerson('ada', 'Ada.Lovelace@Example.com');

const peopleWithIt: ReadonlyArray<readonly [string, readonly PersonRow[], readonly string[], string | undefined]> = [
  ['no one has it', [], ['ada'], undefined],
  ['one person has it verified', [ada], ['ada'], 'ada'],
  ['one person has it, not verified', [aPerson('ada', 'ada.lovelace@example.com', false)], ['ada'], undefined],
  ['one person has it verified and holds no role', [ada], [], undefined],
  [
    'two people have it verified',
    [ada, aPerson('ada-again', 'ADA.LOVELACE@example.com')],
    ['ada', 'ada-again'],
    undefined,
  ],
  [
    'two people have it verified and one holds a role',
    [ada, aPerson('ada-removed', 'ada.lovelace@example.com')],
    ['ada'],
    'ada',
  ],
  [
    'one has it verified and another not',
    [ada, aPerson('ada-unverified', 'ada.lovelace@example.com', false)],
    ['ada', 'ada-unverified'],
    'ada',
  ],
];

describe('the one person of the organization with a verified address', () => {
  it.each([
    ['the same address', 'Ada.Lovelace@Example.com', 'ada'],
    ['the letters A to Z in either case', 'ada.lovelace@EXAMPLE.COM', 'ada'],
    ['another address', 'grace@example.com', undefined],
    ['spaces around it', ' Ada.Lovelace@Example.com', undefined],
    ['no address', '', undefined],
  ])('is found by %s', async (_case, address, found) => {
    const { match } = matchOver([ada], ['ada']);

    expect(await match(address)).toBe(found);
  });

  it.each([
    ['letters beyond A to Z in another case', aPerson('zoe', 'ZOË@example.com'), 'zoë@example.com'],
    ['a Kelvin sign where the address has a K', aPerson('kim', 'kim@example.com'), 'Kim@example.com'],
    ['a dotted capital I where the address has an i', aPerson('iris', 'iris@example.com'), 'İris@example.com'],
  ])('is not found by %s, which only a wider fold than A to Z would match', async (_case, person, address) => {
    const { match } = matchOver([person], [person.person]);

    expect(await match(address)).toBeUndefined();
  });
});

describe('the one person of the organization with a verified address, among the people who have it', () => {
  it.each(peopleWithIt)('where %s, is that person or no one', async (_case, people, holding, found) => {
    const { match } = matchOver(people, holding);

    expect(await match('ada.lovelace@example.com')).toBe(found);
  });

  it('asks the role only of those who have the address verified', async () => {
    const { match, asked } = matchOver(
      [ada, aPerson('grace', 'grace@example.com'), aPerson('ada-unverified', 'ada.lovelace@example.com', false)],
      ['ada'],
    );

    await match('ada.lovelace@example.com');

    expect(asked).toEqual(['ada']);
  });
});
