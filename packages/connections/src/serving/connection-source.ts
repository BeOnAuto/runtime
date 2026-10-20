import {
  isConnectionServerSettings,
  servedFieldsOf,
  type ConnectionServer,
  type ConnectionServing,
  type ConnectionSource,
  type ConnectionUnready,
  type OrgConnection,
} from '@on.auto/tool-servers';
import { Effect, Option, Result } from 'effect';

import { entryIssuesOf, readAddition } from '../entries/entry-checks.ts';
import { reachesUnder, useRefusalOf } from '../policy/policy-rules.ts';
import { providingOf } from '../providers/provider-additions.ts';
import { connectionsFold, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { newestFirst, type KeptConnection } from '../registry/registry.ts';
import { consentAuthOf, givenOf, loggedCauses, notAllowed } from './given-credentials.ts';
import type { Serving, ServingServices } from './serving-services.ts';
import { servingWords } from './serving-words.ts';

function servingOf(org: string, { name, type, provider, entry }: KeptConnection['connection']): ConnectionServing {
  return { name, type, provider, orgs: [org], ...servedFieldsOf(entry) };
}

function unchecked(name: string, issues: ReturnType<typeof entryIssuesOf>): ConnectionUnready {
  return notAllowed(
    servingWords.unchecked(
      name,
      issues.map(({ detail }) => detail),
    ),
  );
}

function preparedServer(serving: Serving): Effect.Effect<ConnectionServer, ConnectionUnready> {
  const { policy, modelProviders } = serving.services;
  const { connection } = serving.kept;
  const checking = { org: serving.org, modelProviders, providing: providingOf(connection, serving.services) };
  return Effect.gen(function* () {
    const refusal = useRefusalOf(policy, connection, checking.providing?.documentServer);
    if (refusal !== undefined) {
      return yield* Effect.fail(notAllowed(refusal.detail));
    }
    const issues = entryIssuesOf(connection, checking);
    if (issues.length > 0) {
      return yield* Effect.fail(unchecked(connection.name, issues));
    }
    const given = yield* givenOf(serving);
    const auth = yield* consentAuthOf(serving);
    const read = readAddition(connection, checking, given);
    if (Result.isFailure(read)) {
      return yield* Effect.fail(unchecked(connection.name, read.failure));
    }
    const settings = Option.getOrThrow(Option.liftPredicate(read.success, isConnectionServerSettings));
    return { settings: auth === undefined ? settings : { ...settings, auth }, reaches: reachesUnder(policy) };
  });
}

function orgConnectionOf(serving: Serving): OrgConnection {
  const { connection } = serving.kept;
  const { id, name, status } = connection;
  const serves = { id, serving: servingOf(serving.org, connection) };
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
          unready: { because: 'connection_broken', detail: Option.getOrThrow(Option.fromNullishOr(connection.broken)) },
        },
      }
    : { ...serves, state: { status: 'connected', server: preparedServer(serving) } };
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
