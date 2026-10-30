import { readFileSync, statSync } from 'node:fs';

import { Data, Result, type Schema } from 'effect';

import type { Environment } from '../server-config.ts';
import { readYaml, type Position, type YamlDocument, type YamlKind } from '../yaml/yaml-reading.ts';
import { settingCredentialProblems } from './credentials.ts';
import { below, entriesOf, type FileProblem } from './file-problem.ts';
import type { FileSetting } from './file-setting.ts';
import { placeIn } from './places.ts';
import { referencedVariablesOf, substituted } from './references.ts';

export class ConfigFileInvalid extends Data.TaggedError('ConfigFileInvalid')<{ readonly message: string }> {}

export interface ConfigFile {
  readonly path: string;
  readonly settings: ReadonlyMap<string, string>;
  readonly referenced: readonly string[];
  readonly place: (setting: string, pointer: string) => string;
}

interface Located {
  readonly position: Position;
  readonly place: string;
  readonly detail: string;
}

interface SettingReading {
  readonly written: readonly (readonly [string, string])[];
  readonly problems: readonly FileProblem[];
}

const mostBytes = 1_048_576;

const configYaml: YamlKind = {
  noun: 'the configuration file',
  mapping: 'The configuration file is a YAML mapping from setting names to values',
  mostDepth: 32,
  emptyIsMapping: true,
};

const reasons: ReadonlyMap<string, string> = new Map([
  ['ENOENT', 'does not exist'],
  ['EISDIR', 'is a directory'],
]);

function unusable(path: string, reason: string): ConfigFileInvalid {
  return new ConfigFileInvalid({ message: `The configuration file ${path}, which CONFIG_FILE names, ${reason}` });
}

function sourceOf(path: string): Result.Result<string, ConfigFileInvalid> {
  try {
    return statSync(path).size > mostBytes
      ? Result.fail(unusable(path, 'is larger than 1 MiB'))
      : Result.succeed(readFileSync(path, 'utf8'));
  } catch (failure) {
    const code = String(Reflect.get(new Object(failure), 'code'));
    return Result.fail(unusable(path, reasons.get(code) ?? `could not be read (${code})`));
  }
}

function invalid(path: string, problems: readonly Located[]): ConfigFileInvalid {
  const listed = problems
    .toSorted((left, right) =>
      left.position.line === right.position.line
        ? left.position.column - right.position.column
        : left.position.line - right.position.line,
    )
    .map(({ place, detail }) => `${place}: ${detail}`)
    .join('; ');
  return new ConfigFileInvalid({ message: `The configuration file ${path} is invalid: ${listed}` });
}

function settingReading(fileSetting: FileSetting, raw: Schema.Json, environment: Environment): SettingReading {
  const pointer = below('', fileSetting.key);
  const refused = settingCredentialProblems(fileSetting.key, raw, fileSetting);
  if (refused.length > 0) {
    return { written: [], problems: refused };
  }
  const resolved = substituted(raw, pointer, environment);
  if (resolved.problems.length > 0) {
    return { written: [], problems: resolved.problems };
  }
  const value = fileSetting.references === 'kept' ? raw : resolved.value;
  return Result.match(fileSetting.written(value), {
    onSuccess: (text): SettingReading => ({ written: [[fileSetting.setting, text]], problems: [] }),
    onFailure: (problems): SettingReading => ({
      written: [],
      problems: problems.map((problem) => ({ pointer: `${pointer}${problem.pointer}`, detail: problem.detail })),
    }),
  });
}

function unknownKeyProblems(document: YamlDocument, keys: readonly string[]): readonly FileProblem[] {
  const held = `it holds ${keys.join(', ')}`;
  return Object.keys(document.value)
    .filter((key) => !keys.includes(key))
    .map((key) => ({ pointer: below('', key), detail: `Not a setting this file holds; ${held}` }));
}

function settingsIn(
  path: string,
  document: YamlDocument,
  settings: readonly FileSetting[],
  environment: Environment,
): Result.Result<ConfigFile, ConfigFileInvalid> {
  const known = new Map(settings.map((fileSetting) => [fileSetting.key, fileSetting]));
  const readings = entriesOf(document.value).flatMap(([key, raw]) => {
    const fileSetting = known.get(key);
    return fileSetting === undefined ? [] : [settingReading(fileSetting, raw, environment)];
  });
  const problems = [
    ...unknownKeyProblems(document, [...known.keys()]),
    ...readings.flatMap((reading) => reading.problems),
  ];
  const located = ({ pointer, detail }: FileProblem): Located => {
    const position = document.locate(pointer);
    return { position, place: placeIn(path, position, pointer), detail };
  };
  if (problems.length > 0) {
    return Result.fail(
      invalid(
        path,
        problems.map((problem) => located(problem)),
      ),
    );
  }
  return Result.succeed({
    path,
    settings: new Map(readings.flatMap((reading) => reading.written)),
    referenced: [...new Set(entriesOf(document.value).flatMap(([, raw]) => referencedVariablesOf(raw)))],
    place: (setting, pointer) =>
      located({ pointer: `${below('', setting.toLowerCase())}${pointer}`, detail: '' }).place,
  });
}

export function readConfigFile(
  path: string,
  settings: readonly FileSetting[],
  environment: Environment,
): Result.Result<ConfigFile, ConfigFileInvalid> {
  return Result.flatMap(sourceOf(path), (source) => {
    const reading = readYaml(source, configYaml);
    if ('problems' in reading) {
      return Result.fail(
        invalid(
          path,
          reading.problems.map(({ position, detail }) => ({ position, place: placeIn(path, position, ''), detail })),
        ),
      );
    }
    return settingsIn(path, reading.document, settings, environment);
  });
}
