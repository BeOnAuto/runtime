import type { Environment } from '@on.auto/config';
import { Effect, Record } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

export interface CountBounds {
  readonly setting: string;
  readonly least: number;
  readonly most: number;
  readonly example: number;
}

type Counts<Name extends string> = { readonly [Count in Name]: number };

interface Counting<Name extends string> {
  readonly settings: string;
  readonly bounds: { readonly [Count in Name]: CountBounds };
}

const wholeNumber = /^\d{1,7}$/u;

export function countOf(text: string): number {
  return wholeNumber.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

function countIn(environment: Environment, { setting, example }: CountBounds): number {
  const written = environment[setting] ?? '';
  return written === '' ? example : countOf(written);
}

function problemsOf(count: number, { setting, least, most, example }: CountBounds): readonly string[] {
  return count >= least && count <= most
    ? []
    : [`${setting}: Expected a whole number from ${least} to ${most}, such as ${example}`];
}

export function countsIn<Name extends string>(
  environment: Environment,
  { settings, bounds }: Counting<Name>,
): Effect.Effect<Counts<Name>, InvalidSettingsError> {
  const counts = Record.map(bounds, (bound) => countIn(environment, bound));
  const problems = Record.collect(bounds, (name, bound) => problemsOf(counts[name], bound)).flat();
  return problems.length === 0
    ? Effect.succeed(counts)
    : Effect.fail(new InvalidSettingsError({ message: `The ${settings} are invalid. ${problems.join('; ')}` }));
}
