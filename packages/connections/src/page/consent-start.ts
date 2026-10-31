import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import { issuedToken, tenMinutesOn, tokenSha256Of } from '../links/link-token.ts';
import { ClientSourceField, ExpiresAtField } from '../operations/connection-fields.ts';
import { actedNow, loadRegistry, recordChangeInRegistry } from '../operations/registry-access.ts';
import { startableConnectionOf } from '../registry/consent-decisions.ts';
import { forgottenVerifierOf, namedOf, sourcesFor, type ConsentServices } from './consent-asking.ts';
import { askedForASignIn, consentRefusalOf, verifierUnkeptOf } from './consent-refusals.ts';
import { LinkSchema, askedOfTheLink } from './link-operations.ts';

const StartedSchema = Schema.Struct({
  authorize: Schema.Struct({
    url: Schema.String.annotate({
      description: 'The page of the authorization server, where the person signs in and allows Auto',
    }),
    expires_at: ExpiresAtField.annotate({
      description: 'When the consent must be finished by, ten minutes on, in ISO 8601 UTC',
    }),
  }),
  client_source: ClientSourceField.annotate({
    description:
      "The source of the client the consent was started with; auto where it began through Auto's consent service, whose finish takes a handle in place of a code, and own where it began under the organization's own OAuth client",
  }),
}).annotate({
  identifier: 'StartedConsent',
  description: 'Where the person signs in at the authorization server and allows Auto',
});

export function defineStartConsent(services: ConsentServices) {
  const { consent, secrets, bindsPerson } = services;
  return defineHttpOperation('org', 'command', {
    name: 'start',
    title: 'Start consent',
    description: [
      "Starts the consent of a connection a person connects by signing in at its authorization server and allowing Auto, through the connection's open link, and answers the page of that authorization server to send the person to.",
      "A link of a connection asks the scopes its credential asks with those of the scopes it asked that it was granted, where a client here covers them, and a link reconnect_connection gave for a group of more asks the scopes it asked that it was granted, or its credential's while it was granted none, with the group's, so the person keeps what they allowed before.",
      "A connection under the organization's own OAuth client starts with the client give_client gave, at the provider's authorization server, never through Auto's consent service, and is refused until it is given.",
      'The consent is finished within ten minutes, and a second start replaces the first.',
      'A connection that is connected stays connected with its credential while it is connected again, until the finish replaces the credential.',
      'On a runtime that signs people in, only the person who added the connection may start it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/consent' },
    body: { kind: 'json' },
    successStatus: 201,
    inputSchema: LinkSchema,
    outputSchema: StartedSchema,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, token }) {
      const use = { connection: id, token_sha256: tokenSha256Of(token), bindsPerson };
      const kept = yield* Effect.fromResult(startableConnectionOf(yield* loadRegistry, use, yield* actedNow));
      const sources = yield* sourcesFor(kept.connection, services);
      const { scope, says } = yield* Effect.fromResult(askedOfTheLink(kept, services.providers, sources));
      const asked = yield* askedForASignIn(kept, services, scope);
      const named = namedOf(kept.connection);
      const state = issuedToken();
      const started = yield* consent
        .start({ ...asked, state: state.token, studioBase: studioBaseFor(services.pages) })
        .pipe(Effect.mapError((refusal) => consentRefusalOf(named, refusal)));
      const verifierSecretId = yield* secrets
        .keep(started.verifier)
        .pipe(Effect.mapError(({ detail }) => verifierUnkeptOf(named, detail)));
      const expiresAt = yield* tenMinutesOn;
      const { before } = yield* recordChangeInRegistry({
        type: 'start',
        ...use,
        state_sha256: tokenSha256Of(started.state),
        verifier_secret_id: verifierSecretId,
        ...started.client,
        expires_at: expiresAt,
        scope,
        says,
      }).pipe(Effect.onError(() => secrets.forget(verifierSecretId)));
      yield* forgottenVerifierOf(before, services);
      return { authorize: { url: started.url, expires_at: expiresAt }, client_source: started.client.client_source };
    }),
  });
}
