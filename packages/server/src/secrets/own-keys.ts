import { randomBytes } from 'node:crypto';

import type { AppRuntime, RetryStateKeys } from '@on.auto/api';
import { byTheRuntime } from '@on.auto/connections';
import {
  ActedContextSchema,
  Conflict,
  factOf,
  type Context,
  type Decided,
  type Decider,
  type DispatcherServices,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import { secretKeyBytes, type SecretStore } from '@on.auto/secrets';
import { Data, DateTime, Effect, Option, Redacted, Result, Schema } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { keyHeldBy } from '../logging/logging.ts';
import { secretsKeyOfBase64 } from '../settings/secrets-settings.ts';
import type { Settings } from '../settings/settings.ts';

export const ownKeysStream = 'runtime/own-keys';

const OwnKeyPurposeSchema = Schema.Literals(['retry_state']);

type OwnKeyPurpose = typeof OwnKeyPurposeSchema.Type;

const OwnKeyEventSchema = Schema.Union([
  factOf('own_key_kept', Schema.Struct({ purpose: OwnKeyPurposeSchema, secret_id: Schema.String }), ActedContextSchema),
]);

export type OwnKeyEvent = typeof OwnKeyEventSchema.Type;

export interface OwnKeyKeeping {
  readonly purpose: OwnKeyPurpose;
  readonly secret_id: string;
  readonly by: string;
  readonly at: string;
}

type OwnKeys = ReadonlyMap<OwnKeyPurpose, string>;

const noOwnKeys: OwnKeys = new Map();

function evolveOwnKeys(keys: OwnKeys, { data }: OwnKeyEvent): OwnKeys {
  const kept = new Map(keys);
  kept.delete(data.purpose);
  return kept.set(data.purpose, data.secret_id);
}

export const ownKeysDecider: Decider<OwnKeys, OwnKeyKeeping, OwnKeyEvent, 'conflict'> = {
  initialState: noOwnKeys,
  evolve: evolveOwnKeys,
  decide: ({ purpose, secret_id }, keys): Result.Result<readonly Decided<OwnKeyEvent>[], Conflict> =>
    keys.has(purpose)
      ? Result.fail(new Conflict({ kind: 'taken', detail: `The runtime keeps a key for ${purpose} already` }))
      : Result.succeed([{ type: 'own_key_kept', data: { purpose, secret_id } }]),
  context: ({ by, at }): Context => ({ by, at }),
  eventSchema: OwnKeyEventSchema,
};

class OwnKeyUnavailable extends Data.TaggedError('OwnKeyUnavailable')<{ readonly message: string }> {}

interface Worded {
  readonly detail: string;
}

export interface SecretsKept {
  readonly where: string;
  readonly gone: string;
  readonly waysOut: string;
  readonly logKeyRead: (purpose: OwnKeyPurpose, secretId: string) => Effect.Effect<void>;
}

interface Asked {
  readonly purpose: OwnKeyPurpose;
  readonly kept: SecretsKept;
}

const keyWaysOut =
  "Start the server with the key the ledger's secrets were sealed under, or give that key as SECRETS_KEY_PREVIOUS, SECRETS_KEY_FILE_PREVIOUS or SECRETS_KEY_KMS_PREVIOUS beside a new key";

export function secretsKeptBy({ secrets, keepers }: Pick<Settings, 'secrets' | 'keepers'>): SecretsKept {
  const { current } = keepers;
  if (current.kind === 'aws-parameter-store') {
    const where = `in AWS Parameter Store under ${current.prefix} in ${current.region}`;
    return {
      where,
      gone: `${where}, the region ${current.regionSetting} names`,
      waysOut: `Start the server with the keeper the ledger's secrets were kept by, or name that keeper as SECRETS_KEEPER_PREVIOUS beside ${current.setting}`,
      logKeyRead: (purpose, secretId) =>
        Effect.logInfo(`The runtime read the key it keeps for ${purpose} ${where}`).pipe(
          Effect.annotateLogs({ own_key: purpose, own_key_id: secretId }),
        ),
    };
  }
  const { current: keyFrom } = Option.getOrThrow(Option.fromNullishOr(secrets));
  return {
    where: `under the key ${keyHeldBy(keyFrom)}`,
    gone: 'in the secret store',
    waysOut: keyWaysOut,
    logKeyRead: () => Effect.void,
  };
}

function unreadableUnder({ purpose, kept }: Asked, words: string): OwnKeyUnavailable {
  return new OwnKeyUnavailable({
    message: `The key the runtime keeps for ${purpose} cannot be read ${kept.where}: ${words}. ${kept.waysOut}`,
  });
}

function unkeptUnder({ purpose, kept }: Asked, words: string): OwnKeyUnavailable {
  return new OwnKeyUnavailable({
    message: `The key the runtime keeps for ${purpose} cannot be kept ${kept.where}, so the server does not start: ${words}`,
  });
}

function unusable({ purpose }: Asked, why: string): OwnKeyUnavailable {
  return new OwnKeyUnavailable({
    message: `The key the runtime keeps for ${purpose} ${why}, so the server does not start`,
  });
}

interface OwnKeyServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretStore, 'keep' | 'read' | 'forget'>;
}

function aKeyInBase64(): Redacted.Redacted {
  return Redacted.make(randomBytes(secretKeyBytes).toString('base64'));
}

function keptAndRecorded(
  { registry, secrets }: OwnKeyServices,
  asked: Asked,
): Effect.Effect<string | undefined, OwnKeyUnavailable> {
  return Effect.gen(function* () {
    const secretId = yield* Effect.mapError(secrets.keep(aKeyInBase64()), (failure: Worded) =>
      unkeptUnder(asked, failure.detail),
    );
    const at = DateTime.formatIso(yield* DateTime.now);
    const keeping = { purpose: asked.purpose, secret_id: secretId, by: byTheRuntime, at };
    return yield* registry.execute(ownKeysStream, ownKeysDecider, keeping).pipe(
      Effect.as(secretId),
      Effect.catch(() => Effect.andThen(secrets.forget(secretId), Effect.undefined)),
    );
  });
}

function ownKeyIdOf(services: OwnKeyServices, asked: Asked): Effect.Effect<string, OwnKeyUnavailable> {
  return Effect.gen(function* () {
    const { state } = yield* services.registry.load(ownKeysStream, ownKeysDecider);
    const recorded = state.get(asked.purpose) ?? (yield* keptAndRecorded(services, asked));
    return recorded ?? (yield* ownKeyIdOf(services, asked));
  });
}

function ownKeyIn(
  { secrets }: OwnKeyServices,
  asked: Asked,
  secretId: string,
): Effect.Effect<Redacted.Redacted<Uint8Array>, OwnKeyUnavailable> {
  return secrets.read(secretId).pipe(
    Effect.mapError((failure: Worded) => unreadableUnder(asked, failure.detail)),
    Effect.flatMap((stored) =>
      stored === undefined
        ? Effect.fail(unusable(asked, `is no longer ${asked.kept.gone}`))
        : Option.match(Option.fromNullishOr(secretsKeyOfBase64(Redacted.value(stored.value))), {
            onNone: () => Effect.fail(unusable(asked, `holds something other than ${secretKeyBytes} bytes`)),
            onSome: Effect.succeed,
          }),
    ),
  );
}

export function retryStateKeysKeptBy(
  services: OwnKeyServices,
  kept: SecretsKept,
): Effect.Effect<RetryStateKeys, OwnKeyUnavailable> {
  const asked: Asked = { purpose: 'retry_state', kept };
  return Effect.gen(function* () {
    const secretId = yield* ownKeyIdOf(services, asked);
    const key = yield* ownKeyIn(services, asked, secretId);
    yield* kept.logKeyRead(asked.purpose, secretId);
    return { current: key };
  });
}

export async function retryStateKeysOf(
  runtime: AppRuntime<DispatcherServices>,
  secrets: SecretStore,
  kept: SecretsKept,
): Promise<RetryStateKeys> {
  try {
    return await Effect.runPromiseWith(runtime.context)(
      retryStateKeysKeptBy({ registry: runtimeLedger(runtime), secrets }, kept),
    );
  } catch (failure) {
    await secrets.close();
    throw failure;
  }
}
