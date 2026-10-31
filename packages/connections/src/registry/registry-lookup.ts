import { Conflict, Forbidden, InvalidInput, NotFound } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { LinkUse } from './connection-commands.ts';
import { runsUnderTheOrgsOAuthClient } from './connection.ts';
import {
  signingInClientOf,
  type KeptConnection,
  type OpenLink,
  type Registry,
  type StartedConsent,
} from './registry.ts';

export interface KeptWithLink extends KeptConnection {
  readonly link: OpenLink;
}

export interface KeptWithConsent extends KeptWithLink {
  readonly consent: StartedConsent;
}

interface Acted {
  readonly by: string;
  readonly at: string;
}

function connectionNotFound(id: string): NotFound {
  return new NotFound({ detail: `There is no connection ${id} in this org` });
}

const noOpenLink = new NotFound({ detail: 'There is no open link of this token: it is unknown, used up or expired' });

function replacedLink(name: string): NotFound {
  return new NotFound({
    detail: `There is no open link of this token: a newer link of the connection ${name} replaced it`,
  });
}

function unusableLinkOf({ connection, replacedLinks }: KeptConnection, tokenSha256: string): NotFound {
  return replacedLinks.has(tokenSha256) ? replacedLink(connection.name) : noOpenLink;
}

export function keptConnectionOf(registry: Registry, id: string): Result.Result<KeptConnection, NotFound> {
  const kept = registry.get(id);
  return kept === undefined ? Result.fail(connectionNotFound(id)) : Result.succeed(kept);
}

export function findConnection(registry: Registry, id: string): Effect.Effect<KeptConnection, NotFound> {
  return Effect.fromResult(keptConnectionOf(registry, id));
}

function isOfTheToken(kept: KeptConnection, tokenSha256: string): kept is KeptWithLink {
  return kept.link !== undefined && kept.link.token_sha256 === tokenSha256;
}

function isOpen(kept: KeptConnection, tokenSha256: string, at: string): kept is KeptWithLink {
  return isOfTheToken(kept, tokenSha256) && kept.link.expires_at > at;
}

export function bindingRefusalOf(
  { connection }: KeptConnection,
  bindsPerson: boolean,
  by: string,
): Forbidden | undefined {
  return bindsPerson && connection.added_by.id !== by
    ? new Forbidden({
        detail: `The connection ${connection.name} was added by another person, and only they may approve it`,
      })
    : undefined;
}

function boundConnectionOf(
  registry: Registry,
  { connection, token_sha256: tokenSha256, bindsPerson }: LinkUse,
  { by }: Acted,
  isUsable: (kept: KeptConnection, tokenSha256: string) => kept is KeptWithLink,
): Result.Result<KeptWithLink, NotFound | Forbidden> {
  return Result.flatMap(
    keptConnectionOf(registry, connection),
    (kept): Result.Result<KeptWithLink, NotFound | Forbidden> => {
      if (!isUsable(kept, tokenSha256)) {
        return Result.fail(unusableLinkOf(kept, tokenSha256));
      }
      const refusal = bindingRefusalOf(kept, bindsPerson, by);
      return refusal === undefined ? Result.succeed(kept) : Result.fail(refusal);
    },
  );
}

export function linkedConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: Acted,
): Result.Result<KeptWithLink, NotFound | Forbidden> {
  return boundConnectionOf(registry, use, acted, (kept, tokenSha256) => isOpen(kept, tokenSha256, acted.at));
}

export function finishableConnectionOf(
  registry: Registry,
  use: LinkUse,
  acted: Acted,
): Result.Result<KeptWithLink, NotFound | Forbidden> {
  return boundConnectionOf(registry, use, acted, isOfTheToken);
}

export function isOpenConsent(kept: KeptWithLink, at: string): kept is KeptWithConsent {
  return kept.consent !== undefined && kept.consent.expires_at > at;
}

export function noOpenConsent(name: string): NotFound {
  return new NotFound({
    detail: `There is no open consent of the connection ${name}: none was started, or it was started more than ten minutes ago`,
  });
}

export function stateIssueOf({ consent }: KeptWithConsent, stateSha256: string): InvalidInput | undefined {
  return consent.state_sha256 === stateSha256
    ? undefined
    : new InvalidInput({
        detail: 'The consent cannot be finished as it is given',
        issues: [{ pointer: '/state', detail: 'Expected the state the consent was started with' }],
      });
}

function givenAgainMeanwhile(name: string): Conflict {
  return new Conflict({
    detail: `The organization's own OAuth client for the connection ${name} was given again meanwhile, so the person signs in again under the client given last`,
  });
}

export function clientChangedOf(kept: KeptConnection, clientId: string): Conflict | undefined {
  return runsUnderTheOrgsOAuthClient(kept.connection) && signingInClientOf(kept)?.client_id !== clientId
    ? givenAgainMeanwhile(kept.connection.name)
    : undefined;
}
