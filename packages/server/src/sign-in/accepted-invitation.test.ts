import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { admittedAfter, type Admitting } from './admission.ts';

const signedInWith = {
  signedIn: { issuer: 'https://login.example.com/acme', subject: '248289761001' },
  claims: { name: 'Ada Lovelace', email: 'ada@example.com' },
};

function admittingThrough(invitations: Admitting['invitations'], reported: (what: string) => void): Admitting {
  return {
    setup: { requiredClaimSet: () => Promise.reject(new Error('Not asked')) },
    requiredClaim: undefined,
    enrolling: {
      enrolled: () => Promise.resolve({ enrolled: 'invitation' }),
      holdsARole: () => Promise.resolve(false),
      firstAdminAwaited: () => Promise.resolve(false),
      invitationPending: () => Promise.resolve(true),
    },
    people: {
      kept: () => Promise.resolve(),
      listed: () => Promise.resolve([]),
      found: () => Promise.resolve().then(Function.constUndefined),
      deleted: () => Promise.resolve(),
    },
    invitations,
    report: {
      userInfoUnread: Function.constVoid,
      notRevoked: Function.constVoid,
      addressNotForgotten: () => {
        reported('addressNotForgotten');
      },
    },
  };
}

describe('a person who accepted an invitation at sign-in', () => {
  it('has its address forgotten, and is admitted where it could not be forgotten, which is reported', async () => {
    const forgotten: (readonly string[])[] = [];
    const reported: string[] = [];
    const report = (what: string) => {
      reported.push(what);
    };
    const forgetting: Admitting['invitations'] = {
      forgotten: (invitations) => {
        forgotten.push(invitations);
        return Promise.resolve();
      },
    };
    const failing: Admitting['invitations'] = { forgotten: () => Promise.reject(new Error('unwritten')) };

    const accepted = await admittedAfter(admittingThrough(forgetting, report), signedInWith, 1, 'an-invitation');
    const unforgotten = await admittedAfter(admittingThrough(failing, report), signedInWith, 1, 'an-invitation');

    expect([accepted, unforgotten]).toMatchObject([{ enrolled: 'invitation' }, { enrolled: 'invitation' }]);
    expect([forgotten, reported]).toEqual([[['an-invitation']], ['addressNotForgotten']]);
  });
});
