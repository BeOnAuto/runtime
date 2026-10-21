import type { Environment } from '@on.auto/config';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';

export type KeeperGiven =
  | { readonly kind: 'ledger'; readonly setting: string }
  | {
      readonly kind: 'aws-parameter-store';
      readonly setting: string;
      readonly prefix: string;
      readonly region: string;
      readonly regionSetting: string;
    };

export interface KeeperSettings {
  readonly current: KeeperGiven;
  readonly previous: KeeperGiven | undefined;
}

export const currentKeeper = 'SECRETS_KEEPER';

export const previousKeeper = 'SECRETS_KEEPER_PREVIOUS';

const namedRegion = 'AWS_REGION';

export const defaultRegion = 'AWS_DEFAULT_REGION';

export const keeperVariables: readonly string[] = [currentKeeper, previousKeeper];

const keeperSources = Config.all({
  current: Config.map(Config.option(Config.String(currentKeeper)), Option.getOrUndefined),
  previous: Config.map(Config.option(Config.String(previousKeeper)), Option.getOrUndefined),
  regions: Config.all([
    Config.map(Config.option(Config.String(namedRegion)), Option.getOrUndefined),
    Config.map(Config.option(Config.String(defaultRegion)), Option.getOrUndefined),
  ]),
});

const ledgerKeeper = 'ledger';

const parameterStoreKeeper = 'aws-parameter-store';

const mostPrefixSegments = 14;

const parameterSegment = /^[\w.-]+$/u;

const reservedSegment = /^(?:aws|ssm)/iu;

const aKeeperInWords = `${ledgerKeeper}, or ${parameterStoreKeeper}:<prefix> with the prefix an absolute parameter path such as /auto-runtime/secrets, of at most ${mostPrefixSegments} segments of letters, digits, '.', '-' and '_', the first beginning with neither aws nor ssm, and no slash at its end`;

function invalid(detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The secrets settings are invalid. ${detail}` });
}

function isParameterPath(prefix: string): boolean {
  const segments = prefix.split('/').slice(1);
  return (
    prefix.startsWith('/') &&
    segments.length <= mostPrefixSegments &&
    segments.every((segment) => parameterSegment.test(segment)) &&
    !reservedSegment.test(String(segments[0]))
  );
}

interface Region {
  readonly region: string;
  readonly regionSetting: string;
}

function keeperIn(
  setting: string,
  given: string,
  region: Region | undefined,
): Effect.Effect<KeeperGiven, InvalidSettingsError> {
  const text = given.trim();
  if (text === ledgerKeeper) {
    return Effect.succeed({ kind: ledgerKeeper, setting });
  }
  const prefix = text.startsWith(`${parameterStoreKeeper}:`) ? text.slice(parameterStoreKeeper.length + 1) : '';
  if (!isParameterPath(prefix)) {
    return Effect.fail(invalid(`${setting}: Expected ${aKeeperInWords}`));
  }
  return region === undefined
    ? Effect.fail(
        invalid(
          `${setting}: AWS Parameter Store is asked in the region ${namedRegion} names, or ${defaultRegion} where that is not set, and neither is, so set ${namedRegion}`,
        ),
      )
    : Effect.succeed({ kind: parameterStoreKeeper, setting, prefix, ...region });
}

function regionIn([named, byDefault]: readonly (string | undefined)[]): Region | undefined {
  const given: readonly Region[] = [
    { region: named?.trim() ?? '', regionSetting: namedRegion },
    { region: byDefault?.trim() ?? '', regionSetting: defaultRegion },
  ];
  return given.find(({ region }) => region !== '');
}

function previousKeeperIn(
  current: KeeperGiven,
  given: string,
  region: Region | undefined,
): Effect.Effect<KeeperGiven, InvalidSettingsError> {
  return Effect.flatMap(keeperIn(previousKeeper, given, region), (previous) =>
    previous.kind === current.kind
      ? Effect.fail(
          invalid(
            `${previousKeeper}: Set it to the keeper ${currentKeeper} replaces, which is the other of ${ledgerKeeper} and ${parameterStoreKeeper}:<prefix>`,
          ),
        )
      : Effect.succeed(previous),
  );
}

export function readKeeperSettings(environment: Environment): Effect.Effect<KeeperSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const given = yield* Effect.orDie(keeperSources.parse(ConfigProvider.fromEnvRecord(environment)));
    const region = regionIn(given.regions);
    if (given.current === undefined) {
      return given.previous === undefined
        ? { current: { kind: ledgerKeeper, setting: currentKeeper }, previous: undefined }
        : yield* Effect.fail(
            invalid(`${previousKeeper}: Set it only beside ${currentKeeper}, to the keeper that one replaces`),
          );
    }
    const current = yield* keeperIn(currentKeeper, given.current, region);
    return {
      current,
      previous: given.previous === undefined ? undefined : yield* previousKeeperIn(current, given.previous, region),
    };
  });
}

export function isLedgerNamed({ current, previous }: KeeperSettings): boolean {
  return current.kind === ledgerKeeper || previous?.kind === ledgerKeeper;
}
