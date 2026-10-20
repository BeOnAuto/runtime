import { allPermissions, defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import { issuedToken, tenMinutesOn, tokenSha256Of } from '../links/link-token.ts';
import { ClientSourceField, ExpiresAtField } from '../operations/connection-fields.ts';
import { actedNow, loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import { startableConnectionOf } from '../registry/registry-decisions.ts';
import { consentAskedOf, forgottenVerifierOf, namedOf, type ConsentServices } from './consent-asking.ts';
import { consentRefusalOf } from './consent-words.ts';
import { LinkSchema } from './link-operations.ts';

const StartedSchema = Schema.Struct({
  authorize: Schema.Struct({
    url: Schema.String.annotate({
      description: "The page of the provider's authorization server, where the person signs in and allows Auto",
    }),
    expires_at: ExpiresAtField.annotate({
      description: 'When the consent must be finished by, ten minutes on, in ISO 8601 UTC',
    }),
  }),
  client_source: ClientSourceField.annotate({
    description:
      "The source of the client the consent was started with; auto where it began through Auto's consent service, whose finish takes a handle in place of a code",
  }),
}).annotate({ identifier: 'StartedConsent', description: 'Where the person signs in to the provider and allows Auto' });

export function defineStartConsent(services: ConsentServices) {
  const { consent, secrets, bindsPerson } = services;
  return defineHttpOperation('org', 'command', {
    name: 'start',
    title: 'Start consent',
    description: [
      "Starts the consent of a connection whose provider a person connects by signing in to it and allowing Auto, through the connection's open link, and answers the page of the provider's authorization server to send the person to.",
      'The consent is finished within ten minutes, and a second start replaces the first.',
      'On a runtime that signs people in, only the person who added the connection may start it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/consent' },
    body: { kind: 'json' },
    successStatus: 201,
    permittedBy: allPermissions,
    inputSchema: LinkSchema,
    answer: { kind: 'json', outputSchema: StartedSchema },
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, token }) {
      const use = { connection: id, token_sha256: tokenSha256Of(token), bindsPerson };
      const kept = yield* Effect.fromResult(startableConnectionOf(yield* loadRegistry, use, yield* actedNow));
      const asked = consentAskedOf(kept.connection, services);
      const state = issuedToken();
      const started = yield* consent
        .start({ ...asked, state: state.token, studioBase: studioBaseFor(services.pages) })
        .pipe(Effect.mapError((refusal) => consentRefusalOf(namedOf(kept.connection), refusal)));
      const verifierSecretId = yield* Effect.orDie(secrets.keep(started.verifier));
      const expiresAt = yield* tenMinutesOn;
      yield* recordInRegistry({
        type: 'start',
        ...use,
        state_sha256: tokenSha256Of(started.state),
        verifier_secret_id: verifierSecretId,
        ...started.client,
        expires_at: expiresAt,
      }).pipe(Effect.onError(() => secrets.forget(verifierSecretId)));
      yield* forgottenVerifierOf(kept, services);
      return { authorize: { url: started.url, expires_at: expiresAt }, client_source: started.client.client_source };
    }),
  });
}
