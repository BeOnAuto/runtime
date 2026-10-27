import { Effect } from 'effect';

import { prepareMeter } from '../database/schema.ts';
import { keepIdentity, readIdentity } from './identity-store.ts';
import { createIdentity, identitySigner } from './installation-key.ts';
import type { InstallationSigner, InstallationStorage, StoredIdentity } from './records.ts';

async function durableIdentity(storage: InstallationStorage): Promise<StoredIdentity> {
  const existing = await readIdentity(storage.connection);
  if (existing !== undefined) return existing;
  const proposed = await createIdentity(storage.secrets);
  try {
    await keepIdentity(storage.connection, proposed);
  } catch (error) {
    const committed = await readIdentity(storage.connection);
    if (committed === undefined) throw error;
  }
  const committed = await readIdentity(storage.connection);
  if (committed === undefined) throw new Error('installation_identity_unavailable');
  if (committed.secretId !== proposed.secretId) await Effect.runPromise(storage.secrets.forget(proposed.secretId));
  return committed;
}

export async function openInstallation(storage: InstallationStorage): Promise<InstallationSigner> {
  await prepareMeter(storage.connection);
  return identitySigner(storage.secrets, await durableIdentity(storage));
}
