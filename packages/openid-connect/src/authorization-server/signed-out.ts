import type { ProviderRows } from './provider-rows.ts';

export const modelsOfAGrant = ['AccessToken', 'AuthorizationCode', 'RefreshToken'] as const;

export function everyoneSignedOut(rows: Pick<ProviderRows, 'endedEvery'>): Promise<void> {
  return rows.endedEvery(['Session', 'Interaction', 'Grant', ...modelsOfAGrant]);
}
