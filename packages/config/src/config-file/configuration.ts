import { Result } from 'effect';

import type { SettingProblem } from '../json-settings/json-setting.ts';
import type { Environment } from '../server-config.ts';
import { readConfigFile, type ConfigFile, type ConfigFileInvalid } from './config-file.ts';
import type { FileSetting } from './file-setting.ts';

export const configFileVariable = 'CONFIG_FILE';

export interface FileUse {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
  readonly referenced: readonly string[];
  readonly place: (setting: string, pointer: string) => string;
  readonly placed: (problem: SettingProblem) => string;
}

export interface Configuration {
  readonly environment: Environment;
  readonly file: FileUse | undefined;
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function layered(environment: Environment, { path, settings, referenced, place }: ConfigFile): Configuration {
  const named = [...settings.keys()];
  const overridden = named.filter((setting) => isSet(environment[setting]));
  const fromFile = named.filter((setting) => !overridden.includes(setting));
  return {
    environment: { ...environment, ...Object.fromEntries(fromFile.map((setting) => [setting, settings.get(setting)])) },
    file: {
      path,
      fromFile,
      overridden,
      referenced,
      place,
      placed: ({ setting, pointer = '', detail }) => `${place(setting, pointer)}: ${detail}`,
    },
  };
}

export function configurationOf(
  environment: Environment,
  settings: readonly FileSetting[],
): Result.Result<Configuration, ConfigFileInvalid> {
  const path = environment[configFileVariable];
  return isSet(path)
    ? Result.map(readConfigFile(path, settings, environment), (file) => layered(environment, file))
    : Result.succeed({ environment, file: undefined });
}
