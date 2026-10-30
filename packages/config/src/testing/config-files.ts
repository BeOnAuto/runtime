import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { configurationOf, type Configuration } from '../config-file/configuration.ts';
import { fileSetting } from '../config-file/file-setting.ts';
import type { Environment } from '../server-config.ts';

export const exampleSettings = [
  fileSetting(
    'EXAMPLE_GATEWAYS',
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        api_key: Schema.optionalKey(Schema.String),
        headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        enabled: Schema.optionalKey(Schema.Boolean),
      }),
    ),
    (gateways) => JSON.stringify(gateways),
  ),
  fileSetting('EXAMPLE_ORIGINS', Schema.Array(Schema.String.check(Schema.isPattern(/^https:\/\//u))), (origins) =>
    origins.join(','),
  ),
  fileSetting(
    'EXAMPLE_SERVERS',
    Schema.Record(Schema.String, Schema.Struct({ headers: Schema.Record(Schema.String, Schema.String) })),
    (servers) => JSON.stringify(servers),
    { references: 'kept' },
  ),
  fileSetting(
    'EXAMPLE_RULES',
    Schema.Struct({
      credential_kinds: Schema.Array(Schema.String),
      ways: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            description: Schema.optionalKey(Schema.String),
            client_id: Schema.optionalKey(Schema.String),
          }),
        ),
      ),
      placeholders: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
    (rules) => JSON.stringify(rules),
    { sortsOfCredential: ['credential_kinds'], prose: ['description'], judgedByShape: ['placeholders'] },
  ),
];

export function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-config-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

export function configFileWith(text: string): string {
  const path = join(temporaryDirectory(), 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

export function configured(text: string, environment: Environment = {}): Configuration {
  return Result.getOrThrow(configurationOf({ CONFIG_FILE: configFileWith(text), ...environment }, exampleSettings));
}

export function messageOf(path: string, environment: Environment = {}): string {
  return Result.getOrThrow(Result.flip(configurationOf({ CONFIG_FILE: path, ...environment }, exampleSettings)))
    .message;
}

export function problemsIn(text: string, environment: Environment = {}): string {
  const path = configFileWith(text);
  return messageOf(path, environment).replaceAll(path, 'auto-runtime.yaml');
}
