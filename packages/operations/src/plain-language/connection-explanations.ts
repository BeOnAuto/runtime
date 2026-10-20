import type { ConflictKind } from '../outcome/conflict.ts';
import type { RejectionBecause } from '../outcome/rejection-because.ts';
import type { Explanation, Remedies } from './plain-language.ts';

type ConnectionBecause = Extract<
  RejectionBecause,
  'connection_pending' | 'connection_broken' | 'connection_not_allowed' | 'connection_unavailable'
>;

export const connectionExplanations: Readonly<Record<Extract<ConflictKind, 'connections_full'>, Explanation>> = {
  connections_full: {
    why: 'the org already holds as many connections as it may',
    remedy: 'Once one of them is removed, another can be added.',
  },
};

export const connectionBecauses: Readonly<Record<ConnectionBecause, string>> = {
  connection_pending: 'because nobody has approved the connection it names yet',
  connection_broken: 'because the credential of the connection it names can no longer be read',
  connection_not_allowed:
    'because the connection it names cannot be used on this server, for the reason the details give',
  connection_unavailable: 'because the credential of the connection it names cannot be read just now',
};

export const connectionRemedies: Remedies = {
  connection_pending:
    'The person who added the connection approves it on the page its link opens, or removes it and adds it again for a new link; then it can be tried again.',
  connection_broken:
    'Trying again will not help: the person removes the connection and adds it again, with its credential.',
  connection_not_allowed:
    'Trying again will not help until what the details say is put right, or it names another tool server, which search shows.',
  connection_unavailable:
    'Nothing needs to change in the connection: trying again later can work, once whoever runs the server puts right what the details say.',
};
