import { defineHttpOperation, OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import { actedNow, loadRegistry, recordChangeInRegistry, recordedCaller } from '../operations/registry-access.ts';
import { finishedConnectionOf } from '../registry/consent-decisions.ts';
import { namedOf, openConsentOf, type FinishedConsent } from './consent-asking.ts';
import { tokensUnkeptOf, wrongShapeOf } from './consent-refusals.ts';
import {
  connectedAnswerOf,
  FinishedSchema,
  notRedeemableOf,
  FinishingSchema,
  isRedeemable,
  redeemedOf,
  returnedOf,
  type Finishing,
} from './consent-returns.ts';
import { installationFinished, type InstallingServices, type Recording } from './installation-finish.ts';
import { replacedWayOf } from './replaced-ways.ts';

type OpenConsent = Effect.Success<ReturnType<typeof openConsentOf>>;

interface Connecting extends Recording {
  readonly kept: OpenConsent;
}

const recordedWith = Effect.fnUntraced(function* (
  finished: FinishedConsent,
  secretId: string,
  { use, stateSha256 }: Recording,
  services: InstallingServices,
) {
  const { client_id: clientId, client_source: clientSource } = finished.client;
  const granted = finished.scope === undefined ? {} : { scope: finished.scope };
  const named = finished.account === undefined ? {} : { account: finished.account };
  return yield* recordChangeInRegistry(services, {
    type: 'finish',
    ...use,
    connected_by: yield* recordedCaller,
    state_sha256: stateSha256,
    secret_id: secretId,
    client_id: clientId,
    client_source: clientSource,
    ...granted,
    ...named,
  });
});

function connectedWith(finished: FinishedConsent, recording: Connecting, services: InstallingServices) {
  const { secrets } = services;
  const named = namedOf(recording.kept.connection);
  return Effect.gen(function* () {
    const secretId = yield* Effect.mapError(secrets.keep(finished.tokens), (failure) => tokensUnkeptOf(named, failure));
    return yield* Effect.andThen(
      secrets.forget(recording.kept.consent.verifier_secret_id),
      recordedWith(finished, secretId, recording, services),
    ).pipe(Effect.onError(() => secrets.forget(secretId)));
  }).pipe(Effect.onError(() => finished.revoked));
}

const finishedConnection = Effect.fnUntraced(function* (finishing: Finishing, services: InstallingServices) {
  const use = { connection: finishing.id, token_sha256: tokenSha256Of(finishing.token) };
  const acted = yield* actedNow;
  const linked = yield* Effect.fromResult(finishedConnectionOf(yield* loadRegistry(services), use));
  const stateSha256 = tokenSha256Of(finishing.state);
  const kept = yield* openConsentOf(linked, { at: acted.at, stateSha256 }, services);
  const began = kept.consent.client_source === 'auto' || kept.consent.client_source === 'gateway' ? 'handle' : 'code';
  const wrongShape = wrongShapeOf(namedOf(kept.connection), began, returnedOf(finishing));
  if (wrongShape !== undefined) {
    return yield* Effect.fail(wrongShape);
  }
  if (kept.connection.credential.installation !== undefined) {
    return yield* installationFinished(kept, finishing, { use, stateSha256 }, services);
  }
  if (!isRedeemable(finishing)) {
    return yield* Effect.fail(notRedeemableOf);
  }
  const finished = yield* redeemedOf(kept, finishing, services);
  const { before, after } = yield* connectedWith(finished, { use, stateSha256, kept }, services);
  yield* replacedWayOf(before, after, services);
  return connectedAnswerOf(after.connection);
});

export function defineFinishConsent(services: InstallingServices) {
  return defineHttpOperation('org', 'command', {
    name: 'finish',
    title: 'Finish consent',
    description: [
      'Finishes the consent of a connection with the code and the state its authorization server sent the person back with, which connects it, and answers it connected.',
      "A consent begun through Auto's consent service is finished with the handle and the state the service sent the person back with instead.",
      'The runtime keeps the tokens sealed in its secret store, and no answer, record or history of the org ever holds them.',
      'Where the secret store cannot read the verifier just now, it answers unavailable and the same code may be tried again; where it cannot keep the tokens once the code is redeemed, it answers unavailable, revokes them, and the person starts again, since the code is spent.',
      'On a runtime that signs people in, only an admin of the organization may finish it.',
      'A connection made by installing an application connects only to an installation that the service lists for the person who signed in, on an account they administer, their own or an organization they are an admin of, as the service confirms at that moment. It keeps none of their tokens. With no installation chosen, it answers the installations they can reach, each marked whether they administer its account, and the page where they install the application, and connects nothing. Where the service sent the person back with an installation and none was chosen, it answers the ID of that installation and connects nothing: start the consent again, and finish it with that ID as installation. Where the service says the person only asked for an installation, it answers requested and connects nothing.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/consent/code' },
    body: { kind: 'json' },
    reachesOutside: true,
    mayChangeOutside: true,
    connectionsManagement: true,
    inputSchema: FinishingSchema,
    outputSchema: FinishedSchema,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* (finishing) {
      const { org } = yield* OrgContext;
      return yield* finishedConnection(finishing, services).pipe(
        Effect.annotateLogs({ org, connection: finishing.id }),
      );
    }),
  });
}
