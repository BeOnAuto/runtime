import type { AppCredentialRefused } from './connection-events.ts';
import type { AppCredentialHeld } from './connection.ts';

export type AppSecretIds = Readonly<Record<string, string>>;

export function appCredentialsHeldOf(appSecretIds: AppSecretIds): readonly AppCredentialHeld[] {
  return Object.keys(appSecretIds).map((name) => ({ name, refused: null }));
}

export function appCredentialsAfter(
  held: readonly AppCredentialHeld[],
  { data, context }: AppCredentialRefused,
): readonly AppCredentialHeld[] {
  const refused = { detail: data.reason, at: context.at };
  return held.map((each) => (each.name === data.name ? { ...each, refused } : each));
}

export function appSecretsHeldBy({ appSecretIds }: { readonly appSecretIds: AppSecretIds }): readonly string[] {
  return Object.values(appSecretIds);
}
