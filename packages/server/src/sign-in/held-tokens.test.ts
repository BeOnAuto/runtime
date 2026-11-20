import {
  personIdOf,
  type PersonSignedIn,
  type RequiredClaim,
  type SignedInWith,
  type TokensReleased,
} from '@on.auto/openid-connect';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { admittedAfter, type Admitting } from './admission.ts';

const signedIn = { issuer: 'https://login.example.com/acme', subject: '248289761001' };

const person = personIdOf(signedIn);

interface Admitted {
  readonly admitting: Admitting;
  readonly kept: readonly PersonSignedIn[];
  readonly reported: readonly (readonly string[])[];
}

function admittedBy(requiredClaim?: RequiredClaim): Admitted {
  const [kept, reported]: [PersonSignedIn[], string[][]] = [[], []];
  const admitting: Admitting = {
    enrolling: {
      enrolled: () => Promise.resolve({ enrolled: 'enrolment' }),
      holdsARole: () => Promise.resolve(true),
      firstAdminAwaited: () => Promise.resolve(false),
      invitationPending: () => Promise.resolve(false),
    },
    setup: { requiredClaimSet: () => Promise.reject(new Error('Not asked')) },
    invitations: { forgotten: () => Promise.resolve() },
    people: {
      kept: (signedInPerson) => {
        kept.push(signedInPerson);
        return Promise.resolve();
      },
      listed: () => Promise.resolve([]),
      found: () => Promise.resolve().then(Function.constUndefined),
      deleted: () => Promise.resolve(),
    },
    requiredClaim,
    report: {
      nameUnread: (id, failure) => {
        reported.push(['nameUnread', id, failure]);
      },
      notRevoked: (failure) => {
        reported.push(['notRevoked', failure]);
      },
      addressNotForgotten: () => {
        reported.push(['addressNotForgotten']);
      },
    },
  };
  return { admitting, kept, reported };
}

interface Holding {
  readonly signedInWith: SignedInWith;
  readonly asked: readonly boolean[];
}

function holding(released: TokensReleased, value?: string): Holding {
  const asked: boolean[] = [];
  const held = {
    released: (nameAsked: boolean) => {
      asked.push(nameAsked);
      return Promise.resolve(released);
    },
  };
  const carried = value === undefined ? {} : { valueOfTheRequiredClaim: value };
  return { asked, signedInWith: { signedIn, claims: { email: 'ada@example.com' }, ...carried, held } };
}

describe("the provider's tokens a sign-in holds, at the callback", () => {
  it('are released once the required claim is decided, asking for the name only of a person who carries it, who is kept with it, and releasing a refused person’s all the same', async () => {
    const { admitting, kept } = admittedBy({ claim: 'tenant', requiredValue: 'acme' });
    const [refused, carrying] = [holding({}, 'another'), holding({ name: 'Ada Lovelace' }, 'acme')];

    const answered = [
      await admittedAfter(admitting, refused.signedInWith, 1),
      await admittedAfter(admitting, carrying.signedInWith, 2),
    ];

    expect(answered).toEqual([
      { refusedForTheClaim: { claim: 'tenant', requiredValue: 'acme' } },
      { signedIn, person, enrolled: 'enrolment' },
    ]);
    expect([...refused.asked, ...carrying.asked]).toEqual([false, true]);
    expect(kept).toEqual([{ person, name: 'Ada Lovelace', emailAddress: 'ada@example.com', updatedAt: 2 }]);
  });

  it('report a name that could not be read by the person’s id alone, and a refresh token that could not be revoked, and the person is admitted with the claims of their ID Token', async () => {
    const { admitting, kept, reported } = admittedBy();
    const released = { nameUnread: 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED', notRevoked: 'invalid_client' };

    const answered = await admittedAfter(admitting, holding(released).signedInWith, 1);

    expect(answered).toEqual({ signedIn, person, enrolled: 'enrolment' });
    expect(kept).toEqual([{ person, emailAddress: 'ada@example.com', updatedAt: 1 }]);
    expect(reported).toEqual([
      ['nameUnread', person, 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED'],
      ['notRevoked', 'invalid_client'],
    ]);
  });
});
