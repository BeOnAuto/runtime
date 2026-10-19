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
import { consentRefusalOf, type ConsentRefused } from './consent-words.ts';

const GivenField = Schema.String.check(Schema.isMinLength(1));

const FinishingSchema = Schema.Struct({
  id: ConnectionIdField,
  token: TokenField,
  code: GivenField.annotate({ description: 'The code the authorization server sent the person back with' }),
  state: GivenField.annotate({ description: 'The state the authorization server sent the person back with' }),
  iss: Schema.optionalKey(
    GivenField.annotate({
      description: 'The issuer the authorization server sent the person back with, where it sent one',
    }),
  ),
});

type Finishing = typeof FinishingSchema.Type;

type LinkUse = Parameters<typeof finishedConnectionOf>[1];

interface Recording {
  readonly use: LinkUse;
  readonly stateSha256: string;
  readonly kept: KeptWithConsent;
}

function redeemedOf(
  kept: KeptWithConsent,
  { code, iss }: Finishing,
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
    return yield* consent
      .finish({ ...asked, client, code, iss, verifier: verifier.value })
      .pipe(Effect.mapError((refusal) => consentRefusalOf(namedOf(kept.connection), refusal)));
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
      const finished = yield* redeemedOf(kept, finishing, services);
      const connected = yield* connectedWith(finished, { use, stateSha256, kept }, services);
      return connectionShown(connected.connection, null);
    }),
  });
}
