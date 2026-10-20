import { allPermissions, Conflict, defineHttpOperation, type NotFound } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import { actedNow, loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { finishedConnectionOf } from '../registry/registry-decisions.ts';
import { noOpenConsent, type KeptWithConsent } from '../registry/registry-lookup.ts';
import {
  consentAskedOf,
  namedOf,
  openConsentOf,
  type ConsentServices,
  type FinishedConsent,
} from './consent-asking.ts';
import { finishRefusalOf, wrongShapeOf, type ConsentRefused, type Returned } from './consent-words.ts';

const GivenField = Schema.String.check(Schema.isMinLength(1));

const returnedFields = {
  id: ConnectionIdField,
  token: TokenField,
  state: GivenField.annotate({ description: 'The state the person was sent back with' }),
};

const FinishingSchema = Schema.Union([
  Schema.Struct({
    ...returnedFields,
    code: GivenField.annotate({ description: 'The code the authorization server sent the person back with' }),
    iss: Schema.optionalKey(
      GivenField.annotate({
        description: 'The issuer the authorization server sent the person back with, where it sent one',
      }),
    ),
  }).annotate({
    description: 'The finish of a consent begun with a client whoever runs the runtime registered, or one of its own',
  }),
  Schema.Struct({
    ...returnedFields,
    handle: GivenField.annotate({
      description: "The handle Auto's consent service sent the person back with, which its tokens are handed over for",
    }),
  }).annotate({ description: "The finish of a consent begun through Auto's consent service" }),
]);

type Finishing = typeof FinishingSchema.Type;

type LinkUse = Parameters<typeof finishedConnectionOf>[1];

interface Recording {
  readonly use: LinkUse;
  readonly stateSha256: string;
  readonly kept: KeptWithConsent;
}

function returnedOf(finishing: Finishing): Returned {
  return 'handle' in finishing ? 'handle' : 'code';
}

function returnedFieldsOf(finishing: Finishing) {
  return 'handle' in finishing ? { handle: finishing.handle } : { code: finishing.code, iss: finishing.iss };
}

function redeemedOf(
  kept: KeptWithConsent,
  finishing: Finishing,
  services: ConsentServices,
): Effect.Effect<FinishedConsent, ConsentRefused | NotFound> {
  const { consent, secrets } = services;
  const { client_id: clientId, client_source: clientSource, verifier_secret_id: verifierSecretId } = kept.consent;
  return Effect.gen(function* () {
    const verifier = yield* Effect.orDie(secrets.read(verifierSecretId));
    if (verifier === undefined) {
      return yield* Effect.fail(noOpenConsent(kept.connection.name));
    }
    const asked = consentAskedOf(kept.connection, services);
    const client = { client_id: clientId, client_source: clientSource };
    const named = namedOf(kept.connection);
    return yield* consent
      .finish({ ...asked, client, ...returnedFieldsOf(finishing), verifier: verifier.value })
      .pipe(Effect.mapError((refusal) => finishRefusalOf(named, refusal, returnedOf(finishing))));
  });
}

function recordedWith(finished: FinishedConsent, secretId: string, { use, stateSha256, kept }: Recording) {
  const { client_id: clientId, client_source: clientSource } = kept.consent;
  const granted = finished.scope === undefined ? {} : { scope: finished.scope };
  return recordInRegistry({
    type: 'finish',
    ...use,
    state_sha256: stateSha256,
    secret_id: secretId,
    client_id: clientId,
    client_source: clientSource,
    ...granted,
  });
}

function connectedWith(finished: FinishedConsent, recording: Recording, { secrets }: ConsentServices) {
  return Effect.gen(function* () {
    const secretId = yield* Effect.mapError(secrets.keep(finished.tokens), ({ detail }) => new Conflict({ detail }));
    return yield* Effect.andThen(
      secrets.forget(recording.kept.consent.verifier_secret_id),
      recordedWith(finished, secretId, recording),
    ).pipe(Effect.onError(() => secrets.forget(secretId)));
  }).pipe(Effect.onError(() => finished.revoked));
}

export function defineFinishConsent(services: ConsentServices) {
  const { bindsPerson } = services;
  return defineHttpOperation('org', 'command', {
    name: 'finish',
    title: 'Finish consent',
    description: [
      'Finishes the consent of a connection with the code and the state its authorization server sent the person back with, which connects it, and answers it connected.',
      "A consent begun through Auto's consent service is finished with the handle and the state the service sent the person back with instead.",
      'The runtime keeps the tokens sealed in its secret store, and no answer, record or history of the org ever holds them.',
      'On a runtime that signs people in, only the person who added the connection may finish it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/consent/code' },
    body: { kind: 'json' },
    permittedBy: allPermissions,
    inputSchema: FinishingSchema,
    answer: { kind: 'json', outputSchema: ConnectionSchema },
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* (finishing) {
      const use = { connection: finishing.id, token_sha256: tokenSha256Of(finishing.token), bindsPerson };
      const acted = yield* actedNow;
      const linked = yield* Effect.fromResult(finishedConnectionOf(yield* loadRegistry, use, acted));
      const stateSha256 = tokenSha256Of(finishing.state);
      const kept = yield* openConsentOf(linked, { at: acted.at, stateSha256 }, services);
      const began = kept.consent.client_source === 'auto' ? 'handle' : 'code';
      const wrongShape = wrongShapeOf(namedOf(kept.connection), began, returnedOf(finishing));
      if (wrongShape !== undefined) {
        return yield* Effect.fail(wrongShape);
      }
      const finished = yield* redeemedOf(kept, finishing, services);
      const connected = yield* connectedWith(finished, { use, stateSha256, kept }, services);
      return connectionShown(connected.connection, null);
    }),
  });
}
