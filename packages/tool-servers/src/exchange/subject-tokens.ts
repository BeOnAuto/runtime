import type { webcrypto } from 'node:crypto';

import type { SubjectTokensOfACall } from '@on.auto/operations';

export interface SubjectTokens extends SubjectTokensOfACall {
  readonly issuer: string;
  keySet(): Promise<{ readonly keys: readonly webcrypto.JsonWebKey[] }>;
}
