import type { Environment } from '@on.auto/config';
import {
  accessModeOf,
  defaultStudioOrigin,
  type ApiKey,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import { asInvalidSettings, InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { httpOffTheLoopbackIn, StudioOrigin } from '../settings/origin.ts';

export const studioVariables: readonly string[] = ['STUDIO_ORIGIN', 'SERVE_STUDIO'];

interface Access {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly signIn: SignInSettings | undefined;
}

const studioSettings = Config.all({
  origin: Config.schema(StudioOrigin, 'STUDIO_ORIGIN').pipe(Config.withDefault(defaultStudioOrigin)),
  served: Config.option(Config.Literals(['true', 'false'], 'SERVE_STUDIO')),
});

export function readStudioSettings(environment: Environment, { host, apiKeys, signIn }: Access): StudioSettings {
  const { origin, served } = Effect.runSync(
    asInvalidSettings(studioSettings.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  const refusal = httpOffTheLoopbackIn('STUDIO_ORIGIN', origin);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  const inLocalMode = accessModeOf({ host, apiKeys, signsIn: signIn !== undefined }) === 'local';
  return { origin, served: Option.match(served, { onNone: () => inLocalMode, onSome: (given) => given === 'true' }) };
}
