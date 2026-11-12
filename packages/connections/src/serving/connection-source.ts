import {
  servedFieldsOf,
  type ConnectionServing,
  type ConnectionSource,
  type OrgConnection,
} from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import { providingOf } from '../providers/provider-additions.ts';
import { connectionsFold, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { newestFirst } from '../registry/registry.ts';
import { connectedAtOf, loggedCauses } from './given-credentials.ts';
import { preparedServer } from './prepared-servers.ts';
import type { Serving, ServingServices } from './serving-services.ts';
import { servingWords } from './serving-words.ts';

function servingOf({ org, kept, services }: Serving): ConnectionServing {
  const { name, type, provider, entry } = kept.connection;
  const handlesMoney = providingOf(kept.connection, services)?.handles_money;
  return {
    name,
    type,
    provider,
    orgs: [org],
    ...servedFieldsOf(entry),
    ...(handlesMoney === undefined ? {} : { handles_money: handlesMoney }),
  };
}

function orgConnectionOf(serving: Serving): OrgConnection {
  const { connection } = serving.kept;
  const { id, name, status } = connection;
  const serves = { id, serving: servingOf(serving) };
  if (status === 'pending') {
    return {
      ...serves,
      state: { status: 'unready', unready: { because: 'connection_pending', detail: servingWords.pending(name) } },
    };
  }
  return status === 'broken'
    ? {
        ...serves,
        state: {
          status: 'unready',
          unready: {
            because: 'connection_broken',
            detail: Option.getOrThrow(Option.fromNullishOr(connection.broken)).detail,
          },
        },
      }
    : {
        ...serves,
        state: { status: 'connected', connectedAt: connectedAtOf(connection), server: preparedServer(serving) },
      };
}

export function makeConnectionSource(services: ServingServices): ConnectionSource {
  const unreadable = loggedCauses();
  return {
    takesConnections: services.policy.peopleMayAdd,
    connectionsOf: (org) =>
      Effect.map(services.registry.load(connectionsStreamOfOrg(org), connectionsFold), ({ state }) =>
        newestFirst(state)
          .filter((kept) => kept.connection.status !== 'removed')
          .map((kept) => orgConnectionOf({ org, kept, services, unreadable })),
      ),
  };
}
