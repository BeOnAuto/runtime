import { describe, expect, it } from 'vitest';

import { signedOutWithTheirLinks } from './member-operations.ts';

function heldBy(model: string, accountId: string) {
  return { sha256: `${model}-${accountId}`, payload: JSON.stringify({ accountId }) };
}

describe('the sign-out of a removed member', () => {
  it('ends their sessions and grants and forgets the accounts at other services linked to them, and no one else’s', async () => {
    const [destroyed, forgotten]: [unknown[], string[]] = [[], []];
    const signedOut = signedOutWithTheirLinks(
      {
        listed: (model) => Promise.resolve([heldBy(model, 'priya'), heldBy(model, 'ada')]),
        destroyed: (key) => {
          destroyed.push(key);
          return Promise.resolve();
        },
      },
      {
        personForgotten: (person) => {
          forgotten.push(person);
          return Promise.resolve();
        },
      },
    );

    await signedOut('priya');

    expect([destroyed, forgotten]).toEqual([
      [
        { model: 'Session', sha256: 'Session-priya' },
        { model: 'Grant', sha256: 'Grant-priya' },
      ],
      ['priya'],
    ]);
  });
});
