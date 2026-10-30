import type { ApiKey } from '../keys/api-key.ts';
import { listensOnlyOnLoopback } from './loopback.ts';

export type AccessMode = 'local' | 'credentials' | 'closed';

export type DeclaredAccessMode = Extract<AccessMode, 'local'>;

export interface AccessFacts {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly signsIn: boolean;
  readonly accessMode?: DeclaredAccessMode | undefined;
}

export function accessModeOf({ host, apiKeys, signsIn, accessMode }: AccessFacts): AccessMode | undefined {
  if (signsIn || (apiKeys !== undefined && apiKeys.length > 0)) {
    return 'credentials';
  }
  if (apiKeys !== undefined) {
    return 'closed';
  }
  return accessMode === 'local' || listensOnlyOnLoopback(host) ? 'local' : undefined;
}
