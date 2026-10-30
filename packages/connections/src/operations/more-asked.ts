import { Conflict, quoted } from '@on.auto/operations';
import { Effect } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import { issuedLink } from '../links/link-token.ts';
import { isCoveredHere } from '../page/consent-asking.ts';
import { moreStillAskedOf, unnamedGroupOf, groupNamed, type AskedMore } from '../providers/asking-more.ts';
import type { Connection } from '../registry/connection.ts';
import type { GroupOfMore } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { foundConnection } from './registry-access.ts';

type MoreAsking = Pick<ConnectionServices, 'providers' | 'consent' | 'pages'>;

interface WithMore extends Connection {
  readonly more: readonly GroupOfMore[];
}

function heldAlready(name: string, more: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} holds every scope of ${quoted(more)} already, so a link for it would ask nothing more`,
  });
}

function uncovered(name: string, more: string, scope: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} cannot be granted ${quoted(more)}, since no client set up here covers every scope its consent would ask, ${scope}`,
  });
}

const askableMore = Effect.fnUntraced(function* (id: string, more: string, services: MoreAsking) {
  const { connection } = yield* foundConnection(id);
  if (groupNamed(connection, services.providers, more) === undefined) {
    return yield* Effect.fail(unnamedGroupOf(connection, services.providers));
  }
  const asked = moreStillAskedOf(connection, services.providers).find(({ group }) => group.name === more);
  if (asked === undefined) {
    return yield* Effect.fail(heldAlready(connection.name, more));
  }
  const sources = yield* services.consent.hadSources(studioBaseFor(services.pages));
  return isCoveredHere(connection, asked.scope, sources)
    ? asked
    : yield* Effect.fail(uncovered(connection.name, more, asked.scope));
});

export const linkIssuedFor = Effect.fnUntraced(function* (id: string, more: string | undefined, services: MoreAsking) {
  if (more === undefined) {
    return yield* issuedLink;
  }
  yield* askableMore(id, more, services);
  return { ...(yield* issuedLink), more };
});

function withMore(connection: Connection, more: readonly GroupOfMore[]): WithMore {
  return { ...connection, more };
}

interface Asking {
  readonly connection: Connection;
  readonly asked: readonly AskedMore[];
}

function askingOf(connection: Connection, { providers }: MoreAsking): Asking {
  return { connection, asked: connection.status === 'removed' ? [] : moreStillAskedOf(connection, providers) };
}

export const moreOfferedTo = Effect.fnUntraced(function* (connections: readonly Connection[], services: MoreAsking) {
  const asking = connections.map((connection) => askingOf(connection, services));
  if (asking.every(({ asked }) => asked.length === 0)) {
    return connections.map((connection) => withMore(connection, []));
  }
  const sources = yield* services.consent.hadSources(studioBaseFor(services.pages));
  return asking.map(({ connection, asked }) =>
    withMore(
      connection,
      asked
        .filter(({ scope }) => isCoveredHere(connection, scope, sources))
        .map(({ group }) => ({ name: group.name, for: group.for })),
    ),
  );
});
