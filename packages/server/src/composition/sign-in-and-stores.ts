import { storesAndConnectionsOf } from '../connections/served-connections.ts';
import type { LedgerDatabase } from '../database/ledger-database.ts';
import { memberOperationsOver } from '../roles/member-operations.ts';
import type { Settings } from '../settings/settings.ts';
import { signInOpened } from './ledger-store.ts';

type Opening = Parameters<typeof signInOpened>[0] & Parameters<typeof storesAndConnectionsOf>[0];

interface OpenedWith {
  readonly settings: Settings;
  readonly database: LedgerDatabase;
  readonly loadAws?: Parameters<typeof storesAndConnectionsOf>[2]['loadAws'];
}

export async function signInAndStoresOpened(
  runtime: Opening,
  { settings, database, loadAws }: OpenedWith,
  ownOrigin: () => string,
) {
  const { clientRegistrationsWith, ...signIn } = await signInOpened(runtime, settings);
  const { linkCodeKey, ...opened } = await storesAndConnectionsOf(runtime, settings, { database, loadAws }, ownOrigin);
  const signInClientRegistrations = clientRegistrationsWith(opened.stores.secrets);
  return {
    opened,
    signIn: { ...signIn, signInClientRegistrations, signingSecrets: opened.stores.secrets, linkCodeKey },
    members: settings.signIn === undefined ? [] : memberOperationsOver(signIn, settings.signIn.publicUrl),
  };
}
