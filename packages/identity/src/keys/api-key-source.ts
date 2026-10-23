import type { ApiKey } from './api-key.ts';

export interface ApiKeySource {
  readonly keyOf: (id: string) => Promise<ApiKey | undefined>;
}

export function configuredApiKeys(keys: readonly ApiKey[] | undefined): ApiKeySource {
  const byId = new Map((keys ?? []).map((key) => [key.id, key]));
  return { keyOf: (id) => Promise.resolve(byId.get(id)) };
}
