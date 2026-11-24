import { createHash, randomBytes } from 'node:crypto';

import { Effect, Redacted } from 'effect';

import { keptHandedOf, keptValueOf, resourcesAskedOf } from '../consent-tokens/kept-tokens.ts';
import type { Requests } from '../consent/acting-clients.ts';
import type {
  ChosenClient,
  ConsentRefusal,
  FinishedConsent,
  HandleFinishAsked,
  StartAsked,
  StartedConsent,
} from '../consent/consent-client.ts';
import { grantedScopeOf } from '../consent/scopes.ts';
import { scopeAskedOf, serverMetadataOf } from '../consent/server-metadata.ts';
import { autoOf, type AutoOn, type ThroughAuto } from './auto-clients.ts';
import type { ConsentReturn, ServiceStartAsked } from './consent-service.ts';

type FetchFor = Requests['fetchFor'];

interface StartingThrough {
  readonly auto: AutoOn;
  readonly clientId: string;
  readonly kind: ConsentReturn['kind'];
}

const clientGone: ConsentRefusal = { refused: 'client_gone' };

const verifierBytes = 32;

export function handoffVerifier(): { readonly verifier: string; readonly challenge: string } {
  const verifier = randomBytes(verifierBytes).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function permissionsAskedOf({ permissions }: StartAsked['way']): Pick<ServiceStartAsked, 'permissions'> {
  return permissions === 'application' ? { permissions } : {};
}

function chosenOf(clientId: string): ChosenClient {
  return { client_id: clientId, client_source: 'auto' };
}

export function startedThroughAuto(
  asked: StartAsked,
  fetchFor: FetchFor,
  { auto, clientId, kind }: StartingThrough,
): Effect.Effect<StartedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const { server, resource } = yield* serverMetadataOf(asked, fetchFor(asked.reaches));
    const { verifier, challenge } = handoffVerifier();
    const { url, state } = yield* auto.service.start({
      issuer: asked.way.issuer,
      scope: scopeAskedOf(asked.way, server),
      parameters: asked.way.parameters,
      resources: resourcesAskedOf(resource, asked.requestOrigins).asked,
      returnTo: { kind, base: asked.studioBase },
      challenge,
      ...permissionsAskedOf(asked.way),
    });
    return { url, state, verifier: Redacted.make(verifier), client: chosenOf(clientId) };
  });
}

export function handedOff(
  asked: HandleFinishAsked,
  fetchFor: FetchFor,
  through: ThroughAuto,
): Effect.Effect<FinishedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const { server, resource } = yield* serverMetadataOf(asked, fetchFor(asked.reaches));
    const auto = autoOf(asked.client, through);
    if (auto === undefined) {
      return yield* Effect.fail(clientGone);
    }
    const handoff = yield* auto.service.takeHandoff(asked.handle, asked.verifier);
    const { tokens, connection_key: key } = handoff;
    const revoked = Effect.ignore(
      auto.service.revoke({
        issuer: asked.way.issuer,
        tokens: keptHandedOf(tokens, undefined, key, []),
        connectionKey: key,
      }),
    );
    const scope = yield* grantedScopeOf(tokens.scope, scopeAskedOf(asked.way, server)).pipe(
      Effect.onError(() => revoked),
    );
    const { recorded } = resourcesAskedOf(resource, asked.requestOrigins);
    return {
      tokens: keptValueOf(keptHandedOf(tokens, scope, key, recorded)),
      scope,
      revoked,
      client: chosenOf(handoff.client_id),
    };
  });
}
