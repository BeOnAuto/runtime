import { configurationOf, readServerConfig, type Environment, type FileUse } from '@on.auto/config';
import { proxySettingsOf, type ProxySettings } from '@on.auto/outbound';
import { Effect, Result } from 'effect';

import { fileSettings } from '../config-file/file-settings.ts';
import { readTelemetrySettings, type TelemetrySettings } from '../telemetry/telemetry-settings.ts';
import {
  readAccessSettings,
  readCredentialSettings,
  type AccessSettings,
  type CredentialSettings,
} from './access-settings.ts';
import { readContentSettings, type ContentSettings } from './content-settings.ts';
import { readLedgerAndSecrets, type LedgerAndSecrets } from './secrets-settings.ts';
import { readServedSettings, type ServedSettings } from './served-settings.ts';

interface ConfigFileSources {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
}

export interface Settings extends ServedSettings, AccessSettings, CredentialSettings, LedgerAndSecrets {
  readonly host: string;
  readonly port: number;
  readonly content: ContentSettings;
  readonly proxy: ProxySettings;
  readonly telemetry: TelemetrySettings | undefined;
  readonly configFile: ConfigFileSources | undefined;
  readonly providerSetup?: string | undefined;
}

function sourcesOf(file: FileUse | undefined): ConfigFileSources | undefined {
  return file === undefined ? undefined : { path: file.path, fromFile: file.fromFile, overridden: file.overridden };
}

export function readSettings(given: Environment): Settings {
  const { environment, file } = Result.getOrThrow(configurationOf(given, fileSettings));
  const { host, port } = readServerConfig(environment);
  const { allowedOrigins, logFormat, logLevel } = Effect.runSync(readAccessSettings(environment));
  const { apiKeys, identityIssuer, signIn, studio } = readCredentialSettings(environment, host);
  const { ledger, secrets } = Effect.runSync(readLedgerAndSecrets(environment));
  const content = Effect.runSync(readContentSettings(environment));
  const served = readServedSettings(environment, file);
  const telemetry = Effect.runSync(readTelemetrySettings(environment));
  return {
    host,
    port,
    allowedOrigins,
    apiKeys,
    identityIssuer,
    signIn,
    studio,
    ledger,
    secrets,
    content,
    proxy: proxySettingsOf(environment),
    logFormat,
    logLevel,
    ...served,
    telemetry,
    configFile: sourcesOf(file),
  };
}
