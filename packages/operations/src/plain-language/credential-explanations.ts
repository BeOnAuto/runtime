import type { RejectionBecause } from '../outcome/rejection-because.ts';
import type { Remedies } from './plain-language.ts';

type CredentialBecause = Extract<RejectionBecause, 'key_refused' | 'scope_lacking'>;

export const credentialBecauses: Readonly<Record<CredentialBecause, string>> = {
  key_refused: 'because the tool server did not accept the key this server gives it',
  scope_lacking: 'because the tool server asks for a scope its credential lacks, which the details name',
};

export const credentialRemedies: Remedies = {
  key_refused: 'Trying again will not help until whoever runs the server checks the key it gives that tool server.',
  scope_lacking: 'Trying again will not help until its credential is granted the scope the details name.',
};
