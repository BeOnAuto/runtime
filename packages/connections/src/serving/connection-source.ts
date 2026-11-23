import {
  servedFieldsOf,
  type ConnectionServing,
  type ConnectionSource,
  type OrgConnection,
} from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import { providingOf } from '../providers/provider-providing.ts';
import { connectionsOfAnOrgReadTogetherIn } from '../registry/connection-rows-read.ts';
import { newestFirst } from '../registry/registry.ts';
import { replacedConnectionWords, replacedOf } from '../replacements/replaced-providers.ts';
import { connectedAtOf, loggedCauses } from './given-credentials.ts';
import { preparedServer } from './prepared-servers.ts';
import type { Serving, ServingServices } from './serving-services.ts';
import { servingWords } from './serving-words.ts';

function servingOf({ org, kept, services }: Serving): ConnectionServing {
  const { name, type, provider, entry } = kept.connection;
  const providing = providingOf(kept.connection, services);
  return {
    name,
    type,
    provider,
    orgs: [org],
    ...servedFieldsOf(entry),
    ...(providing?.handles_money === undefined ? {} : { handles_money: providing.handles_money }),
    ...(providing?.renders === undefined ? {} : { renders: providing.renders }),
  };
}

function orgConnectionOf(serving: Serving): OrgConnection {
  const { connection } = serving.kept;
  const { id, name, status } = connection;
  const serves = { id, serving: servingOf(serving) };
  const replaced = replacedOf(serving.services.providers, connection.provider);
  if (replaced !== undefined) {
    return {
      ...serves,
      state: {
        status: 'unready',
        unready: { because: 'connection_broken', detail: replacedConnectionWords(name, replaced) },
      },
    };
  }
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
  const connectionsOfAnOrg = connectionsOfAnOrgReadTogetherIn(services.registry, services.providers);
  return {
    takesConnections: services.policy.peopleMayAdd,
    connectionsOf: (org) =>
      Effect.map(connectionsOfAnOrg(org), (listed) =>
        newestFirst(listed)
          .filter((kept) => kept.connection.status !== 'removed')
          .map((kept) => orgConnectionOf({ org, kept, services, unreadable })),
      ),
  };
}
