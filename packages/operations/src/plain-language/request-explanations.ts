import type { UnansweredKind } from '../outcome/unanswered-run.ts';
import type { Explanation } from './plain-language.ts';

export const requestExplanations: Readonly<Record<UnansweredKind, Explanation>> = {
  expired: {
    why: 'nobody answered what it asked before the request expired',
    remedy:
      'Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
    mayHaveChanged: true,
  },
  undelivered: {
    why: 'what it had to send could not be delivered, though every attempt was made',
    remedy:
      'Nothing more of it runs; whoever runs the server can look into the tool it names, and then a new run can send it again.',
    mayHaveChanged: true,
  },
  declined: {
    why: 'the person it asked to sign in said they did not',
    remedy: 'Nothing more of it runs; a new run asks them again, once they can sign in.',
    mayHaveChanged: true,
  },
  signed_out: {
    why: 'the person it acts for is not signed in to the site, and its function stops rather than asks them',
    remedy: 'A new run can go on once they have signed in to the site.',
    mayHaveChanged: true,
  },
  no_person: {
    why: 'it acts for no person who can sign in: a key started it, or the person it acts for has left the organization',
    remedy: 'A run a person of the organization starts acts for them and asks them to sign in.',
    mayHaveChanged: true,
  },
};
