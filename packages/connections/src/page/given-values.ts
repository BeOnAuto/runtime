import { OrgContext, type InvalidInput, type Unavailable } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { providingOf } from '../providers/provider-providing.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { appCredentialPointerOf, appCredentialsGivenOf, type GivenAppCredential } from './given-apps.ts';
import { checkedBeforeKeeping, type CheckingServices } from './given-checks.ts';
import { formatMarkOf, givenOf, unkeptRefusalOf, type GivingSchema } from './given-fields.ts';

type Giving = Omit<typeof GivingSchema.Type, 'playbooks'>;

type KeepingServices = CheckingServices & Pick<ConnectionServices, 'secrets'>;

function appSecretsKeptOf(
  name: string,
  apps: readonly GivenAppCredential[],
  { secrets }: Pick<ConnectionServices, 'secrets'>,
  kept: Readonly<Record<string, string>> = {},
): Effect.Effect<Readonly<Record<string, string>>, InvalidInput | Unavailable> {
  const [first, ...rest] = apps;
  if (first === undefined) {
    return Effect.succeed(kept);
  }
  return secrets.keep(Redacted.make(first.value)).pipe(
    Effect.mapError((failure) => unkeptRefusalOf(name, appCredentialPointerOf(first.name), failure)),
    Effect.onError(() => Effect.forEach(Object.values(kept), secrets.forget)),
    Effect.flatMap((secretId) => appSecretsKeptOf(name, rest, { secrets }, { ...kept, [first.name]: secretId })),
  );
}

export const givenValuesKept = Effect.fnUntraced(function* (
  connection: RecordedConnection,
  { app_credentials: appsGiven = {}, ...giving }: Giving,
  services: KeepingServices,
) {
  const { org } = yield* OrgContext;
  const checking = { org, modelProviders: services.modelProviders, providing: providingOf(connection, services) };
  const given = yield* Effect.fromResult(givenOf(connection, giving, checking));
  const formatMark = yield* Effect.fromResult(formatMarkOf(connection, given));
  const apps = yield* Effect.fromResult(appCredentialsGivenOf(connection, appsGiven, services));
  yield* checkedBeforeKeeping(connection, { value: given.value, apps }, services);
  const { secrets } = services;
  const secretId = yield* secrets
    .keep(Redacted.make(given.value), given.endsWith)
    .pipe(Effect.mapError((failure) => unkeptRefusalOf(connection.name, given.pointer, failure)));
  const appSecretIds = yield* appSecretsKeptOf(connection.name, apps, services).pipe(
    Effect.onError(() => secrets.forget(secretId)),
  );
  const kept: readonly string[] = [secretId, ...Object.values(appSecretIds)];
  return { given, formatMark, secretId, appSecretIds, kept };
});
