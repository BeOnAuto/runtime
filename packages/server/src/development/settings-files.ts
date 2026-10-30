import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import type { Environment } from '@on.auto/config';

import type { DevelopmentRun, DevelopmentSetup } from './development-run.ts';

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

export function presentEnvFiles({ envFiles }: DevelopmentSetup): readonly string[] {
  return envFiles.filter((envFile) => existsSync(envFile));
}

export function settingsOf(environment: Environment, setup: DevelopmentSetup): Environment {
  const settings: Record<string, string | undefined> = {};
  for (const envFile of presentEnvFiles(setup)) {
    Object.assign(settings, parseEnv(readFileSync(envFile, 'utf8')));
  }
  return { ...settings, ...environment };
}

export function rootConfigFile({ settings, setup }: DevelopmentRun): Environment {
  return isSet(settings['CONFIG_FILE']) || !existsSync(setup.configFile) ? {} : { CONFIG_FILE: setup.configFile };
}

export function watchedConfigFile(settings: Environment, setup: DevelopmentSetup): string {
  const named = settings['CONFIG_FILE'];
  return isSet(named) ? resolve(named) : setup.configFile;
}
