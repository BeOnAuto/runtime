import {
  ActedContextSchema,
  factOf,
  Unavailable,
  type Decider,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import type { SecretStore } from '@on.auto/secrets';
import { DateTime, Effect, Function, Option, Redacted, Result, Schema } from 'effect';

const licenseKeyStream = 'runtime/license-key';

const LicenseKeyEventSchema = factOf(
  'license_key_kept',
  Schema.Struct({ secret_id: Schema.String }),
  ActedContextSchema,
);

type LicenseKeyEvent = typeof LicenseKeyEventSchema.Type;

interface Keeping {
  readonly secret_id: string;
  readonly by: string;
  readonly at: string;
}

const licenseKeyDecider: Decider<string | undefined, Keeping, LicenseKeyEvent> = {
  initialState: undefined,
  evolve: (_kept, { data }) => data.secret_id,
  eventSchema: LicenseKeyEventSchema,
  decide: ({ secret_id: secretId }) => Result.succeed([{ type: 'license_key_kept', data: { secret_id: secretId } }]),
  context: ({ by, at }) => ({ by, at }),
};

export interface KeptLicenseKeyServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretStore, 'keep' | 'read' | 'forget'>;
}

export interface KeptLicenseKey {
  readonly read: Effect.Effect<string | undefined>;
  readonly keep: (key: string, by: string) => Effect.Effect<void, Unavailable>;
}

interface Worded {
  readonly detail: string;
}

function unkept({ detail }: Worded): Unavailable {
  return new Unavailable({
    detail: `The license is active, but its key could not be kept in the secret store, so it must be activated again after a restart: ${detail}`,
  });
}

function revealed({ value }: { readonly value: Redacted.Redacted }): string {
  return Redacted.value(value);
}

export function keptLicenseKeyOn({ registry, secrets }: KeptLicenseKeyServices): KeptLicenseKey {
  const keptId = Effect.map(registry.load(licenseKeyStream, licenseKeyDecider), ({ state }) => state);
  return {
    read: Effect.flatMap(keptId, (secretId) =>
      Option.match(Option.fromNullishOr(secretId), {
        onNone: () => Effect.undefined,
        onSome: (id) =>
          secrets.read(id).pipe(
            Effect.map((stored) => Option.getOrUndefined(Option.map(Option.fromNullishOr(stored), revealed))),
            Effect.orElseSucceed(Function.constUndefined),
          ),
      }),
    ),
    keep: (key, by) =>
      Effect.gen(function* () {
        const previous = yield* keptId;
        const secretId = yield* Effect.mapError(secrets.keep(Redacted.make(key), key.slice(-4)), unkept);
        const at = DateTime.formatIso(yield* DateTime.now);
        yield* registry.execute(licenseKeyStream, licenseKeyDecider, { secret_id: secretId, by, at }).pipe(
          Effect.tapError(() => secrets.forget(secretId)),
          Effect.mapError(unkept),
        );
        yield* Effect.forEach(Option.toArray(Option.fromNullishOr(previous)), (id) => secrets.forget(id));
      }),
  };
}
