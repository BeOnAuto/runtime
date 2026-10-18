import { Forbidden, NotFound } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { LinkUse } from './connection-commands.ts';
import type { KeptConnection, OpenLink, Registry } from './registry.ts';

export interface KeptWithLink extends KeptConnection {
  readonly link: OpenLink;
}

function connectionNotFound(id: string): NotFound {
  return new NotFound({ detail: `There is no connection ${id} in this org` });
}

const noOpenLink = new NotFound({ detail: 'There is no open link of this token: it is unknown, used up or expired' });

export function keptConnectionOf(registry: Registry, id: string): Result.Result<KeptConnection, NotFound> {
  const kept = registry.get(id);
  return kept === undefined ? Result.fail(connectionNotFound(id)) : Result.succeed(kept);
}

export function findConnection(registry: Registry, id: string): Effect.Effect<KeptConnection, NotFound> {
  return Effect.fromResult(keptConnectionOf(registry, id));
}

function isOpen(kept: KeptConnection, tokenSha256: string, at: string): kept is KeptWithLink {
  const { connection, link } = kept;
  return (
    connection.status === 'pending' && link !== undefined && link.token_sha256 === tokenSha256 && link.expires_at > at
  );
}

export function linkedConnectionOf(
  registry: Registry,
  { connection, token_sha256: tokenSha256, bindsPerson }: LinkUse,
  { by, at }: { readonly by: string; readonly at: string },
): Result.Result<KeptWithLink, NotFound | Forbidden> {
  return Result.flatMap(
    keptConnectionOf(registry, connection),
    (kept): Result.Result<KeptWithLink, NotFound | Forbidden> => {
      if (!isOpen(kept, tokenSha256, at)) {
        return Result.fail(noOpenLink);
      }
      return bindsPerson && kept.connection.added_by !== by
        ? Result.fail(
            new Forbidden({
              detail: `The connection ${kept.connection.name} was added by another person, and only they may approve it`,
            }),
          )
        : Result.succeed(kept);
    },
  );
}
