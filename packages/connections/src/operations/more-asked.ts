import { Effect } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import { issuedLink } from '../links/link-token.ts';
import { isCoveredHere } from '../page/consent-asking.ts';
import {
  groupNamed,
  moreStillAskedOf,
  unnamedGroupOf,
  type AskedMore,
  type MoreAskedBy,
} from '../providers/asking-more.ts';
import type { Connection, RecordedConnection } from '../registry/connection.ts';
import type { GroupOfMore } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { moreHeldAlready, moreUncovered } from './connection-words.ts';
import { foundConnection } from './registry-access.ts';

type MoreAsking = Pick<ConnectionServices, 'providers' | 'consent' | 'pages'>;

type Holding = Pick<RecordedConnection, 'name' | 'provider' | 'credential' | 'asked_scopes' | 'granted_scope'>;

interface WithMore extends Connection {
  readonly more: readonly GroupOfMore[];
}

const askableMore = Effect.fnUntraced(function* (
  connection: Holding,
  more: string,
  services: MoreAsking,
  askedBy: MoreAskedBy,
) {
  if (groupNamed(connection, services.providers, more) === undefined) {
    return yield* Effect.fail(unnamedGroupOf(connection, services.providers, askedBy));
  }
  const asked = moreStillAskedOf(connection, services.providers).find(({ group }) => group.name === more);
  if (asked === undefined) {
    return yield* Effect.fail(moreHeldAlready(connection.name, more));
  }
  const sources = yield* services.consent.hadSources(studioBaseFor(services.pages));
  return isCoveredHere(connection, asked.scope, sources)
    ? asked
    : yield* Effect.fail(moreUncovered(connection.name, more, asked.scope));
});

export const linkIssuedFor = Effect.fnUntraced(function* (id: string, more: string | undefined, services: MoreAsking) {
  if (more === undefined) {
    return yield* issuedLink;
  }
  const { connection } = yield* foundConnection(id);
  yield* askableMore(connection, more, services, 'reconnected');
  return { ...(yield* issuedLink), more };
});

type Admitted = Pick<RecordedConnection, 'name' | 'provider' | 'credential'>;

function heldByNothingYet(given: Admitted): Holding {
  return { ...given, asked_scopes: [], granted_scope: null };
}

export const additionLinkIssuedFor = Effect.fnUntraced(function* (
  given: Admitted,
  more: string | undefined,
  services: MoreAsking,
) {
  if (more === undefined) {
    return yield* issuedLink;
  }
  yield* askableMore(heldByNothingYet(given), more, services, 'added');
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
