import type { Environment } from '@on.auto/config';
import {
  accessModeOf,
  type ApiKey,
  type DeclaredAccessMode,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { namesTheLoopback } from '@on.auto/operations';
import type { AutoClients, ReturnKind } from '@on.auto/tool-servers';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import { asInvalidSettings, InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { ConsentServiceOrigin, defaultConsentService, httpOffTheLoopbackIn } from '../settings/origin.ts';

export const consentVariables: readonly string[] = ['AUTO_CLIENTS', 'CONSENT_SERVICE_URL'];

export interface AutoClientsSettings {
  readonly enabled: boolean;
  readonly serviceUrl: string;
}

export interface AutoClientsDeciding {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly signIn: SignInSettings | undefined;
  readonly accessMode: DeclaredAccessMode | undefined;
  readonly written: boolean | undefined;
}

const autoClientsSettings = Config.all({
  enabled: Config.option(Config.Literals(['true', 'false'], 'AUTO_CLIENTS')),
  serviceUrl: Config.schema(ConsentServiceOrigin, 'CONSENT_SERVICE_URL').pipe(
    Config.withDefault(defaultConsentService),
  ),
});

function isInLocalMode({ host, apiKeys, signIn, accessMode }: AutoClientsDeciding): boolean {
  return accessModeOf({ host, apiKeys, signsIn: signIn !== undefined, accessMode }) === 'local';
}

export function readAutoClientsSettings(environment: Environment, deciding: AutoClientsDeciding): AutoClientsSettings {
  const { enabled, serviceUrl } = Effect.runSync(
    asInvalidSettings(autoClientsSettings.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  const refusal = httpOffTheLoopbackIn('CONSENT_SERVICE_URL', serviceUrl);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  const byDefault = () => deciding.written ?? isInLocalMode(deciding);
  return { enabled: Option.match(enabled, { onNone: byDefault, onSome: (given) => given === 'true' }), serviceUrl };
}

export function returnKindOf({ origin }: StudioSettings): (base: string) => ReturnKind {
  return (base) => {
    if (namesTheLoopback(new URL(base).hostname)) {
      return 'loopback';
    }
    return base === `${origin}/` ? 'hosted' : 'elsewhere';
  };
}

export function autoClientsOf({ enabled, serviceUrl }: AutoClientsSettings, studio: StudioSettings): AutoClients {
  return { enabled, service: { url: serviceUrl }, returnKindOf: returnKindOf(studio) };
}
