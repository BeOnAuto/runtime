import {
  custodianProbed,
  keeperProbed,
  secretStoreOn,
  type Custodians,
  type Keeper,
  type Keepers,
  type SecretStore,
} from '@on.auto/secrets';
import { Effect, Option } from 'effect';

import type { LedgerDatabase } from '../database/ledger-database.ts';
import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { currentKeeper, type KeeperGiven, type KeeperSettings } from '../settings/keeper-settings.ts';
import type { SecretsSettings } from '../settings/secrets-settings.ts';
import { logSecretsInParameterStore, logSecretStore } from './secrets-logging.ts';

export interface SecretsMade {
  readonly custodians: Custodians | undefined;
  readonly keepers: Keepers;
}

export interface SecretsGiven {
  readonly secrets: SecretsSettings | undefined;
  readonly keepers: KeeperSettings;
}

interface Counted {
  readonly moved: number;
  readonly resealed: number;
}

interface Worded {
  readonly detail: string;
}

function invalid(setting: string, detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The secrets settings are invalid. ${setting}: ${detail}` });
}

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function custodianProbedAtStart(
  custodians: Custodians | undefined,
  secrets: SecretsSettings | undefined,
): Effect.Effect<void, InvalidSettingsError> {
  const current = secrets?.current;
  return current?.from === 'kms'
    ? Effect.mapError(custodianProbed(required(custodians).current), ({ detail }: Worded) =>
        invalid(
          current.setting,
          `The KMS key ${required(custodians).current.kid} it names could not wrap and unwrap a data key at start: ${detail}`,
        ),
      )
    : Effect.void;
}

function keeperProbedAtStart(keeper: Keeper, given: KeeperGiven): Effect.Effect<void, InvalidSettingsError> {
  return given.kind === 'aws-parameter-store'
    ? Effect.mapError(keeperProbed(keeper), ({ detail }: Worded) =>
        invalid(
          given.setting,
          `AWS Parameter Store under ${given.prefix} could not write, read and delete a parameter at start: ${detail}`,
        ),
      )
    : Effect.void;
}

function movedUnder(store: SecretStore, { previous }: KeeperSettings): Effect.Effect<number, InvalidSettingsError> {
  return previous === undefined
    ? Effect.orDie(store.moved())
    : Effect.mapError(store.moved(), ({ detail }: Worded) =>
        invalid(
          previous.setting,
          `The secrets its keeper keeps could not be moved to the keeper ${currentKeeper} names: ${detail}`,
        ),
      );
}

function rotatedUnder(
  store: SecretStore,
  secrets: SecretsSettings | undefined,
): Effect.Effect<number, InvalidSettingsError> {
  const previous = secrets?.previous;
  return previous === undefined
    ? Effect.orDie(store.rotated())
    : Effect.mapError(store.rotated(), ({ detail }: Worded) =>
        invalid(
          previous.setting,
          `The secrets its key sealed could not be sealed again under the current key: ${detail}`,
        ),
      );
}

function startLogged(made: SecretsMade, given: SecretsGiven, { moved, resealed }: Counted): Effect.Effect<void> {
  const { current, previous } = given.keepers;
  return current.kind === 'aws-parameter-store'
    ? logSecretsInParameterStore({ prefix: current.prefix, region: current.region, moved })
    : Effect.suspend(() =>
        logSecretStore({
          kid: required(made.custodians).current.kid,
          resealed,
          keyFrom: required(given.secrets).current,
          moved: previous === undefined ? undefined : moved,
        }),
      );
}

export function secretStoreStarted(
  database: LedgerDatabase,
  made: SecretsMade,
  given: SecretsGiven,
): Effect.Effect<SecretStore, InvalidSettingsError> {
  return Effect.gen(function* () {
    yield* custodianProbedAtStart(made.custodians, given.secrets);
    yield* keeperProbedAtStart(made.keepers.current, given.keepers.current);
    const store = secretStoreOn(yield* database.secretRows, made.keepers, made.custodians);
    const moved = yield* movedUnder(store, given.keepers);
    const resealed = yield* rotatedUnder(store, given.secrets);
    yield* startLogged(made, given, { moved, resealed });
    return store;
  });
}
