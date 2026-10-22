import { existsSync, readFileSync } from 'node:fs';

import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const mebibyte = 1_048_576;

const provenInTheImage =
  /^RUN prlimit --core=0 --data=(?<bytes>\d+) node --input-type=module --eval "await import\('\/app\/(?<entry>[^']+)'\)"$/u;

const settingTheUser = /^(?:FROM|USER) /u;

const copiedAsItIs = /^COPY (?<from>\S+) (?<to>\S+)$/u;

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

interface Proof {
  readonly floor: number;
  readonly entry: string;
  readonly user: string | undefined;
  readonly copied: boolean;
}

function copiesAsItIs(line: string, entry: string): boolean {
  const copy = copiedAsItIs.exec(line)?.groups;
  return copy !== undefined && copy['from'] === copy['to'] && entry.startsWith(`${String(copy['to'])}/`);
}

function proofIn(file: string): Proof {
  const lines = file.split('\n');
  const at = lines.findIndex((line) => provenInTheImage.test(line));
  const proof = provenInTheImage.exec(lines[at] ?? '')?.groups;
  const entry = String(proof?.['entry']);
  const before = lines.slice(0, at);
  const image = before.slice(before.findLastIndex((line) => line.startsWith('FROM ')));
  return {
    floor: Number(proof?.['bytes']) / mebibyte,
    entry,
    user: before.findLast((line) => settingTheUser.test(line)),
    copied: image.some((line) => copiesAsItIs(line, entry)),
  };
}

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the prediction function settings', () => {
  it('keep 4 model processes of 1,280 MiB each, 2 of them for the builds being scored, 4 builds a function a day, 32 active functions a playbook, and the files of the models under /var/tmp/auto-runtime, when nothing is set', () => {
    expect(readSettingsOf({}).prediction).toEqual({
      processes: 4,
      processMemoryMebibytes: 1280,
      buildsAtOnce: 2,
      buildsPerDay: 4,
      mostFunctions: 32,
      cacheDirectory: '/var/tmp/auto-runtime',
    });
  });

  it('keep the files of the models in the absolute folder PREDICTION_CACHE_DIR names, and refuse a relative one', () => {
    expect([
      readSettingsOf({ PREDICTION_CACHE_DIR: ' /srv/models ' }).prediction.cacheDirectory,
      readSettingsOf({ PREDICTION_CACHE_DIR: '' }).prediction.cacheDirectory,
      String(errorFrom({ PREDICTION_CACHE_DIR: 'models' })),
    ]).toEqual([
      '/srv/models',
      '/var/tmp/auto-runtime',
      'InvalidSettingsError: The prediction function settings are invalid. PREDICTION_CACHE_DIR: Expected an absolute path, such as /var/tmp/auto-runtime',
    ]);
  });

  it('look for prlimit in the PATH the server was started with, and nowhere without one', () => {
    expect([
      readSettingsOf({ PATH: '/usr/local/bin:/usr/bin' }).prediction.path,
      readSettingsOf({}).prediction.path,
    ]).toEqual(['/usr/local/bin:/usr/bin', undefined]);
  });
});

describe('the prediction function settings given values', () => {
  it('read each of the five', () => {
    expect(
      readSettingsOf({
        PREDICTION_PROCESSES: ' 8 ',
        PREDICTION_PROCESS_MEMORY: '1024',
        PREDICTION_BUILDS_AT_ONCE: '3',
        PREDICTION_BUILDS_PER_DAY: '100',
        PREDICTION_MAX_FUNCTIONS: '1000',
      }).prediction,
    ).toMatchObject({
      processes: 8,
      processMemoryMebibytes: 1024,
      buildsAtOnce: 3,
      buildsPerDay: 100,
      mostFunctions: 1000,
    });
  });

  it('stop the server from starting when one is out of its range or not a whole number, naming each', () => {
    expect(
      String(
        errorFrom({
          PREDICTION_PROCESSES: '1',
          PREDICTION_PROCESS_MEMORY: '16385',
          PREDICTION_BUILDS_AT_ONCE: 'many',
          PREDICTION_BUILDS_PER_DAY: '101',
          PREDICTION_MAX_FUNCTIONS: '0',
        }),
      ),
    ).toBe(
      'InvalidSettingsError: The prediction function settings are invalid. PREDICTION_PROCESSES: Expected a whole number from 2 to 64, such as 4; PREDICTION_PROCESS_MEMORY: Expected a whole number from 768 to 16384, such as 1280; PREDICTION_BUILDS_AT_ONCE: Expected a whole number from 1 to 63, such as 2; PREDICTION_BUILDS_PER_DAY: Expected a whole number from 1 to 100, such as 4; PREDICTION_MAX_FUNCTIONS: Expected a whole number from 1 to 1000, such as 32',
    );
  });
});

describe('the prediction function settings of builds at once', () => {
  it.each([
    ['as many builds at once as there are processes', '4'],
    ['more builds at once than there are processes', '5'],
  ])(
    'stop the server from starting when they keep %s, so that a prediction always finds a process',
    (_what, builds) => {
      expect(String(errorFrom({ PREDICTION_PROCESSES: '4', PREDICTION_BUILDS_AT_ONCE: builds }))).toBe(
        'InvalidSettingsError: The prediction function settings are invalid. PREDICTION_BUILDS_AT_ONCE: Expected a whole number below PREDICTION_PROCESSES, 4, so that a prediction always finds a model process',
      );
    },
  );
});

describe('the least memory of a model process', () => {
  it('is the data under which the image proves, as its user, with every build, that a model process loads its own entry, which the image copies in', () => {
    const { floor, entry, user, copied } = proofIn(dockerfile);

    expect([entry, user, copied, existsSync(new URL(`../../../../${entry}`, import.meta.url))]).toEqual([
      'capabilities/prediction/src/model-jobs/model-process.ts',
      'USER node',
      true,
      true,
    ]);
    expect(readSettingsOf({ PREDICTION_PROCESS_MEMORY: String(floor) }).prediction.processMemoryMebibytes).toBe(floor);
    expect(String(errorFrom({ PREDICTION_PROCESS_MEMORY: String(floor - 1) }))).toBe(
      `InvalidSettingsError: The prediction function settings are invalid. PREDICTION_PROCESS_MEMORY: Expected a whole number from ${floor} to 16384, such as 1280`,
    );
  });
});
