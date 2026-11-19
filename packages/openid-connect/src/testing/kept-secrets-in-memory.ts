import type { KeptSecrets } from '../authorization-server/signing-key.ts';

export interface KeptSecretsInMemory extends KeptSecrets {
  readonly kept: () => readonly string[];
}

export function keptSecretsInMemory(): KeptSecretsInMemory {
  const secrets = new Map<string, string>();
  const made = { count: 0 };
  return {
    keep: (value) => {
      made.count += 1;
      const id = `secret-${String(made.count)}`;
      secrets.set(id, value);
      return Promise.resolve(id);
    },
    read: (id) => Promise.resolve(secrets.get(id)),
    forget: (id) => {
      secrets.delete(id);
      return Promise.resolve();
    },
    kept: () => [...secrets.keys()],
  };
}
