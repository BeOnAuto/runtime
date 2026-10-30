import type { Environment } from '@on.auto/config';
import { Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

export type Distribution = 'npx' | 'docker' | 'source';

export interface UsagePingSettings {
  readonly distribution: Distribution;
}

export const distributionVariable = 'RUNTIME_DISTRIBUTION';

export const usagePingVariables: readonly string[] = [
  'USAGE_PING',
  'DO_NOT_TRACK',
  'SCARF_NO_ANALYTICS',
  distributionVariable,
];

const noRequest: ReadonlySet<string> = new Set(['', '0', 'false']);

const scarfTurnedOff: ReadonlySet<string> = new Set(['1', 'true']);

const usagePingValues: ReadonlySet<string> = new Set(['', 'true', 'false']);

function valueIn(environment: Environment, name: string): string {
  return (environment[name] ?? '').trim().toLowerCase();
}

export function distributionIn(environment: Environment): Distribution {
  const given = valueIn(environment, distributionVariable);
  return given === 'npx' || given === 'docker' ? given : 'source';
}

function turnedOffIn(environment: Environment): boolean {
  return (
    valueIn(environment, 'USAGE_PING') === 'false' ||
    !noRequest.has(valueIn(environment, 'DO_NOT_TRACK')) ||
    scarfTurnedOff.has(valueIn(environment, 'SCARF_NO_ANALYTICS'))
  );
}

export function readUsagePingSettings(
  environment: Environment,
): Effect.Effect<UsagePingSettings | undefined, InvalidSettingsError> {
  if (!usagePingValues.has(valueIn(environment, 'USAGE_PING'))) {
    return Effect.fail(
      new InvalidSettingsError({ message: 'The usage ping setting is invalid. USAGE_PING: Expected true or false' }),
    );
  }
  return Effect.succeed(turnedOffIn(environment) ? undefined : { distribution: distributionIn(environment) });
}
