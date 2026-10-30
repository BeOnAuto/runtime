import type { Environment } from '@on.auto/config';
import { readDuration } from '@on.auto/workflow-engine';
import { mostOpenCallsOfATree } from '@on.auto/workflow-host';
import { Config, ConfigProvider, Effect } from 'effect';

import { countOf } from '../function-settings/counted-settings.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';

export interface WorkflowSettings {
  readonly mostDurationMs: number;
  readonly mostCallsAtOnce: number;
  readonly mostOpenCalls: number;
  readonly sweepEveryMs: number;
}

interface Bounds {
  readonly setting: string;
  readonly least: number;
  readonly most: number;
  readonly expected: string;
}

const hour = 3_600_000;

const mostDuration: Bounds = {
  setting: 'WORKFLOW_MAX_DURATION',
  least: 2 * hour,
  most: 365 * 24 * hour,
  expected: 'Expected an ISO 8601 duration from PT2H to P365D, such as P30D',
};

const sweepInterval: Bounds = {
  setting: 'WORKFLOW_SWEEP_INTERVAL',
  least: 10,
  most: 60_000,
  expected: 'Expected an ISO 8601 duration from PT0.01S to PT1M, such as PT1S',
};

const nestedRuns: Bounds = {
  setting: 'WORKFLOW_NESTED_RUNS',
  least: 1,
  most: 1000,
  expected: 'Expected a whole number from 1 to 1000, such as 32',
};

const openCalls: Bounds = {
  setting: 'WORKFLOW_MAX_OPEN_CALLS',
  least: 1,
  most: 9999,
  expected: `Expected a whole number from 1 to 9999, such as ${mostOpenCallsOfATree}`,
};

export const workflowVariables: readonly string[] = [mostDuration, sweepInterval, nestedRuns, openCalls].map(
  ({ setting }) => setting,
);

const sources = Config.all({
  mostDuration: Config.String(mostDuration.setting).pipe(Config.withDefault('P30D')),
  nestedRuns: Config.String(nestedRuns.setting).pipe(Config.withDefault('32')),
  openCalls: Config.String(openCalls.setting).pipe(Config.withDefault(String(mostOpenCallsOfATree))),
  sweepInterval: Config.String(sweepInterval.setting).pipe(Config.withDefault('PT1S')),
});

function millisecondsOf(text: string): number {
  return { milliseconds: Number.NaN, ...readDuration(text.trim()) }.milliseconds;
}

function problemOf(value: number, { setting, least, most, expected }: Bounds): readonly string[] {
  return value >= least && value <= most ? [] : [`${setting}: ${expected}`];
}

export function readWorkflowSettings(environment: Environment): Effect.Effect<WorkflowSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const source = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    const settings = {
      mostDurationMs: millisecondsOf(source.mostDuration),
      mostCallsAtOnce: countOf(source.nestedRuns),
      mostOpenCalls: countOf(source.openCalls),
      sweepEveryMs: millisecondsOf(source.sweepInterval),
    };
    const problems = [
      ...problemOf(settings.mostDurationMs, mostDuration),
      ...problemOf(settings.mostCallsAtOnce, nestedRuns),
      ...problemOf(settings.mostOpenCalls, openCalls),
      ...problemOf(settings.sweepEveryMs, sweepInterval),
    ];
    return problems.length === 0
      ? settings
      : yield* Effect.fail(
          new InvalidSettingsError({ message: `The workflow settings are invalid. ${problems.join('; ')}` }),
        );
  });
}
