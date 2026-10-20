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
import { secretsKeyOfBase64, type SecretsKeySource } from '../settings/secrets-settings.ts';

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

interface Asked {
  readonly purpose: OwnKeyPurpose;
  readonly keyFrom: SecretsKeySource;
}

function unreadableUnder({ purpose, keyFrom }: Asked, words: string): OwnKeyUnavailable {
  return new OwnKeyUnavailable({
    message: `The key the runtime keeps for ${purpose} cannot be read under the key ${keyHeldBy(keyFrom)}: ${words}. Start the server with the key the ledger's secrets were sealed under, or give that key as SECRETS_KEY_PREVIOUS, SECRETS_KEY_FILE_PREVIOUS or SECRETS_KEY_KMS_PREVIOUS beside a new key`,
  });
}

function unkeptUnder({ purpose, keyFrom }: Asked, words: string): OwnKeyUnavailable {
  return new OwnKeyUnavailable({
    message: `The key the runtime keeps for ${purpose} cannot be kept under the key ${keyHeldBy(keyFrom)}, so the server does not start: ${words}`,
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
        ? Effect.fail(unusable(asked, 'is no longer in the secret store'))
        : Option.match(Option.fromNullishOr(secretsKeyOfBase64(Redacted.value(stored.value))), {
            onNone: () => Effect.fail(unusable(asked, `holds something other than ${secretKeyBytes} bytes`)),
            onSome: Effect.succeed,
          }),
    ),
  );
}

export function retryStateKeysKeptBy(
  services: OwnKeyServices,
  keyFrom: SecretsKeySource,
): Effect.Effect<RetryStateKeys, OwnKeyUnavailable> {
  const asked: Asked = { purpose: 'retry_state', keyFrom };
  return Effect.gen(function* () {
    const secretId = yield* ownKeyIdOf(services, asked);
    return { current: yield* ownKeyIn(services, asked, secretId) };
  });
}

export async function retryStateKeysOf(
  runtime: AppRuntime<DispatcherServices>,
  secrets: SecretStore,
  keyFrom: SecretsKeySource,
): Promise<RetryStateKeys> {
  try {
    return await Effect.runPromiseWith(runtime.context)(
      retryStateKeysKeptBy({ registry: runtimeLedger(runtime), secrets }, keyFrom),
    );
  } catch (failure) {
    await secrets.close();
    throw failure;
  }
}
