import type { FetchLike } from '@modelcontextprotocol/client';
import { Clock, Deferred, Effect, Option, Redacted, Schema } from 'effect';

import { ClientIdSchema, clientMetadataOf } from './client-sources.ts';
import type {
  ClientRegistrations,
  ConsentRefusal,
  KeptRegistration,
  RegistrationPlace,
  RegistrationUnavailable,
} from './consent-client.ts';
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
  place: RegistrationPlace,
  register: Effect.Effect<KeptRegistration, ConsentRefusal>,
) => Effect.Effect<KeptRegistration, ConsentRefusal>;

export interface UnkeptRegistrations {
  readonly heldAt: (place: RegistrationPlace) => KeptRegistration | undefined;
  readonly hold: (place: RegistrationPlace, kept: KeptRegistration) => void;
  readonly release: (place: RegistrationPlace) => void;
}

export interface RegistrationKeeping {
  readonly registrations: ClientRegistrations;
  readonly registeredOnce: Registering;
  readonly unkept: UnkeptRegistrations;
}

export interface Registration {
  readonly place: RegistrationPlace;
  readonly endpoint: string;
  readonly returnAddress: string;
  readonly fetch: FetchLike;
}

const unkeptWords = (issuer: string, clientId: string, detail: string) =>
  `The client registered at ${issuer} as ${clientId} cannot be kept now, so this process keeps it at its next consent there: ${detail}`;

const refusedWords = (issuer: string, clientId: string, detail: string) =>
  `The client registered at ${issuer} as ${clientId} cannot be kept, so it stays registered there unused: ${detail}`;

export function registrationFieldsOf({ registration }: KeptRegistration): RegistrationFields {
  return decodeRegistration(Redacted.value(registration));
}

function isLasting(kept: KeptRegistration, nowMillis: number): boolean {
  const endsAt = registrationFieldsOf(kept).client_secret_expires_at;
  return endsAt === undefined || endsAt === neverEnds || endsAt * millisOfASecond > nowMillis;
}

function keyOf({ issuer, server }: RegistrationPlace): string {
  return JSON.stringify([issuer, server]);
}

function answeredRegistration({
  place,
  endpoint,
  returnAddress,
  fetch,
}: Registration): Effect.Effect<KeptRegistration, ConsentRefusal> {
  return Effect.tryPromise({
    try: async () => {
      const answer = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(clientMetadataOf(returnAddress, place.server)),
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
  return (place, register) =>
    Effect.suspend(() => {
      const key = keyOf(place);
      const flying = registering.get(key);
      if (flying !== undefined) {
        return Deferred.await(flying);
      }
      const registered = Deferred.makeUnsafe<KeptRegistration, ConsentRefusal>();
      registering.set(key, registered);
      return Deferred.into(register, registered).pipe(
        Effect.ensuring(Effect.sync(() => registering.delete(key))),
        Effect.andThen(Deferred.await(registered)),
      );
    });
}

export function unkeptRegistrations(): UnkeptRegistrations {
  const held = new Map<string, KeptRegistration>();
  return {
    heldAt: (place) => held.get(keyOf(place)),
    hold: (place, kept) => {
      held.set(keyOf(place), kept);
    },
    release: (place) => {
      held.delete(keyOf(place));
    },
  };
}

export function registrationUnavailable({ detail }: RegistrationUnavailable): ConsentRefusal {
  return { refused: 'registration_unavailable', detail };
}

function heldUntilKept(
  place: RegistrationPlace,
  kept: KeptRegistration,
  unkept: UnkeptRegistrations,
  failure: RegistrationUnavailable,
): Effect.Effect<never, ConsentRefusal> {
  return Effect.sync(() => {
    unkept.hold(place, kept);
  }).pipe(
    Effect.andThen(Effect.logWarning(unkeptWords(place.issuer, kept.clientId, failure.detail))),
    Effect.andThen(Effect.fail(registrationUnavailable(failure))),
  );
}

function leftUnkept(
  { issuer }: RegistrationPlace,
  kept: KeptRegistration,
  { detail }: RegistrationUnavailable,
): Effect.Effect<never, ConsentRefusal> {
  const refusal: ConsentRefusal = { refused: 'registration_refused', detail };
  return Effect.andThen(Effect.logWarning(refusedWords(issuer, kept.clientId, detail)), Effect.fail(refusal));
}

function isRefused({ _tag }: RegistrationUnavailable): boolean {
  return _tag === 'secret_refused';
}

function keptAt(
  place: RegistrationPlace,
  kept: KeptRegistration,
  { registrations, unkept }: RegistrationKeeping,
): Effect.Effect<KeptRegistration, ConsentRefusal> {
  return registrations.keep(place, kept).pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        isRefused(failure) ? leftUnkept(place, kept, failure) : heldUntilKept(place, kept, unkept, failure),
      onSuccess: () =>
        Effect.sync(() => {
          unkept.release(place);
          return kept;
        }),
    }),
  );
}

export function registrationFor(
  registration: Registration,
  keeping: RegistrationKeeping,
): Effect.Effect<KeptRegistration, ConsentRefusal> {
  const { place } = registration;
  return keeping.registeredOnce(
    place,
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const waiting = keeping.unkept.heldAt(place);
      if (waiting !== undefined && isLasting(waiting, now)) {
        return yield* keptAt(place, waiting, keeping);
      }
      const latest = yield* Effect.mapError(keeping.registrations.latestAt(place), registrationUnavailable);
      if (latest !== undefined && isLasting(latest, now)) {
        return latest;
      }
      return yield* keptAt(place, yield* answeredRegistration(registration), keeping);
    }),
  );
}
