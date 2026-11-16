import { callersByIdOf, configuredApiKeys, type CallersById } from '@on.auto/identity';
import type { AttemptLeaseSettings } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';

export type CallersAccess = Pick<Settings, 'host' | 'apiKeys' | 'signIn' | 'accessMode'>;

export interface ProcessStopping {
  readonly began: () => void;
  readonly underway: () => boolean;
}

export interface AttemptHolding extends AttemptLeaseSettings {
  readonly stopping: ProcessStopping;
}

export function callersByIdIn({ host, apiKeys, signIn, accessMode }: CallersAccess): CallersById {
  return callersByIdOf({
    host,
    apiKeys,
    apiKeySource: configuredApiKeys(apiKeys),
    signsIn: signIn !== undefined,
    accessMode,
  });
}
