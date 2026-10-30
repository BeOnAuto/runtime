import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import type { Environment } from '@on.auto/config';

export interface LocalPlace {
  readonly directory: string;
  readonly home: string;
}

type Settings = Readonly<Record<string, string>>;

const localDefaults: Settings = { HOST: '127.0.0.1', LOG_FORMAT: 'console', LOG_LEVEL: 'error' };

function definedIn(environment: Environment): Settings {
  return Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]: readonly [string, string | undefined]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
}

function fileSettingsIn(directory: string): Settings {
  const envFile = join(directory, '.env');
  const configFile = join(directory, 'auto-runtime.yaml');
  return {
    ...(existsSync(configFile) ? { CONFIG_FILE: configFile } : {}),
    ...(existsSync(envFile) ? definedIn(parseEnv(readFileSync(envFile, 'utf8'))) : {}),
  };
}

function ledgerDefault(chosen: Settings, home: string): Settings {
  const elsewhere = chosen['LEDGER_FILE'] !== undefined || (chosen['DATABASE_URL'] ?? '') !== '';
  return elsewhere ? {} : { LEDGER_FILE: join(home, '.auto-runtime', 'ledger.db') };
}

export function localSettings(environment: Environment, { directory, home }: LocalPlace): Settings {
  const chosen = { ...fileSettingsIn(directory), ...definedIn(environment) };
  return { ...localDefaults, ...ledgerDefault(chosen, home), ...chosen };
}
