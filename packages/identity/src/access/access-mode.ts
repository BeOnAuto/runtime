import type { ApiKey } from '../keys/api-key.ts';
import { listensOnlyOnLoopback } from './loopback.ts';

export type AccessMode = 'local' | 'credentials' | 'closed';

export interface AccessFacts {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly signsIn: boolean;
}

export function accessModeOf({ host, apiKeys, signsIn }: AccessFacts): AccessMode | undefined {
  if (signsIn || (apiKeys !== undefined && apiKeys.length > 0)) {
    return 'credentials';
  }
  if (apiKeys !== undefined) {
    return 'closed';
  }
  return listensOnlyOnLoopback(host) ? 'local' : undefined;
}
