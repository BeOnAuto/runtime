import { localDeveloperId, type CallerIdentity } from '@on.auto/operations';

import { configuredApiKeys, type ApiKeySource } from '../keys/api-key-source.ts';
import { accessModeOf, type AccessFacts } from './access-mode.ts';
import { isKeyHolder, localDeveloperOf, principalOf, type LocalAccount } from './principal.ts';

export interface CallersById {
  readonly readsAgain: (id: string) => boolean;
  readonly callerOf: (org: string, id: string) => Promise<CallerIdentity | undefined>;
}

interface CallersSettings extends AccessFacts {
  readonly apiKeySource: ApiKeySource;
  readonly localAccount?: LocalAccount | undefined;
}

function isTheLocalDeveloper(id: string): boolean {
  return id === localDeveloperId;
}

function isAKey(id: string): boolean {
  return isKeyHolder({ id });
}

function localDeveloperById(account: LocalAccount | undefined): CallersById {
  const developer = localDeveloperOf(account);
  return {
    readsAgain: isTheLocalDeveloper,
    callerOf: (org, id) => Promise.resolve(isTheLocalDeveloper(id) ? developer.callerIn(org) : undefined),
  };
}

function keyHolderById(source: ApiKeySource): CallersById {
  return {
    readsAgain: isAKey,
    callerOf: async (org, id) => {
      const key = isAKey(id) ? await source.keyOf(id) : undefined;
      return key === undefined ? undefined : principalOf(key).callerIn(org);
    },
  };
}

export function callersByIdOf(settings: CallersSettings): CallersById {
  const mode = accessModeOf(settings);
  if (mode === 'local') {
    return localDeveloperById(settings.localAccount);
  }
  return keyHolderById(mode === 'credentials' ? settings.apiKeySource : configuredApiKeys([]));
}
