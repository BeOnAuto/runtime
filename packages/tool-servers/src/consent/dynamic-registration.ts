import type { FetchLike } from '@modelcontextprotocol/client';
import { Clock, Deferred, Effect, Option, Redacted, Schema } from 'effect';

import { ClientIdSchema, clientMetadataOf } from './client-sources.ts';
import type { ClientRegistrations, ConsentRefusal, KeptRegistration } from './consent-client.ts';
import { refusalOf, unanswered } from './consent-failures.ts';

const RegistrationFieldsSchema = Schema.Struct({
  client_id: ClientIdSchema,
  client_secret: Schema.optionalKey(Schema.String),
  client_secret_expires_at: Schema.optionalKey(Schema.Number),
  token_endpoint_auth_method: Schema.optionalKey(Schema.String),
});

type RegistrationFields = typeof RegistrationFieldsSchema.Type;

const RegistrationSchema = Schema.fromJsonString(RegistrationFieldsSchema);

const answeredFieldsOf = Schema.decodeUnknownOption(RegistrationFieldsSchema);

const decodeRegistration = Schema.decodeUnknownSync(RegistrationSchema);

const encodeRegistration = Schema.encodeSync(RegistrationSchema);

const millisOfASecond = 1000;

const neverEnds = 0;

export type Registering = (
  issuer: string,
  register: Effect.Effect<KeptRegistration, ConsentRefusal>,
) => Effect.Effect<KeptRegistration, ConsentRefusal>;

export interface Registration {
  readonly issuer: string;
  readonly endpoint: string;
  readonly returnAddress: string;
  readonly fetch: FetchLike;
}

export function registrationFieldsOf({ registration }: KeptRegistration): RegistrationFields {
  return decodeRegistration(Redacted.value(registration));
}

function isLasting(kept: KeptRegistration, nowMillis: number): boolean {
  const endsAt = registrationFieldsOf(kept).client_secret_expires_at;
  return endsAt === undefined || endsAt === neverEnds || endsAt * millisOfASecond > nowMillis;
}

function answeredRegistration({
  endpoint,
  returnAddress,
  fetch,
}: Registration): Effect.Effect<KeptRegistration, ConsentRefusal> {
  return Effect.tryPromise({
    try: async () => {
      const answer = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(clientMetadataOf(returnAddress)),
      });
      return answer.ok ? answeredFieldsOf(await answer.json()) : Option.none();
    },
    catch: refusalOf,
  }).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(unanswered),
        onSome: (fields) =>
          Effect.succeed({ clientId: fields.client_id, registration: Redacted.make(encodeRegistration(fields)) }),
      }),
    ),
  );
}

export function singleFlight(): Registering {
  const registering = new Map<string, Deferred.Deferred<KeptRegistration, ConsentRefusal>>();
  return (issuer, register) =>
    Effect.suspend(() => {
      const flying = registering.get(issuer);
      if (flying !== undefined) {
        return Deferred.await(flying);
      }
      const registered = Deferred.makeUnsafe<KeptRegistration, ConsentRefusal>();
      registering.set(issuer, registered);
      return Deferred.into(register, registered).pipe(
        Effect.ensuring(Effect.sync(() => registering.delete(issuer))),
        Effect.andThen(Deferred.await(registered)),
      );
    });
}

export function registrationFor(
  registration: Registration,
  registrations: ClientRegistrations,
  registeredOnce: Registering,
): Effect.Effect<KeptRegistration, ConsentRefusal> {
  const { issuer } = registration;
  return registeredOnce(
    issuer,
    Effect.gen(function* () {
      const latest = yield* registrations.latestAt(issuer);
      if (latest !== undefined && isLasting(latest, yield* Clock.currentTimeMillis)) {
        return latest;
      }
      const kept = yield* answeredRegistration(registration);
      yield* registrations.keep(issuer, kept);
      return kept;
    }),
  );
}
