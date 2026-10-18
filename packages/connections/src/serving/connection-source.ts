import type { Issue } from '@on.auto/operations';
import {
  isConnectionServerSettings,
  type ConnectionServer,
  type ConnectionServing,
  type ConnectionSource,
  type ConnectionUnready,
  type OrgConnection,
} from '@on.auto/tool-servers';
import { Effect, Option, Result } from 'effect';

import { entryIssuesOf, readAddition } from '../entries/entry-checks.ts';
import { hostRefusalOf, useRefusalOf } from '../policy/policy-rules.ts';
import { connectionsFold, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { newestFirst, type KeptConnection } from '../registry/registry.ts';
import { givenOf, notAllowed, type Serving, type ServingServices } from './given-credentials.ts';
import { servingWords } from './serving-words.ts';

function servingOf(org: string, { name, kind, entry }: KeptConnection['connection']): ConnectionServing {
  return {
    name,
    type: kind,
    orgs: [org],
    playbooks: entry.playbooks ?? null,
    allowed: entry.allowed ?? null,
    record_content: entry.record_content ?? true,
    request_id: entry.request_id ?? null,
  };
}

function unchecked(name: string, issues: readonly Issue[]): ConnectionUnready {
  return notAllowed(
    servingWords.unchecked(
      name,
      issues.map(({ detail }) => detail),
    ),
  );
}

function preparedServer(serving: Serving): Effect.Effect<ConnectionServer, ConnectionUnready> {
  const { policy, providers } = serving.services;
  const { connection } = serving.kept;
  const checking = { org: serving.org, providers };
  return Effect.gen(function* () {
    const refusal = useRefusalOf(policy, connection);
    if (refusal !== undefined) {
      return yield* Effect.fail(notAllowed(refusal.detail));
    }
    const issues = entryIssuesOf(connection, checking);
    if (issues.length > 0) {
      return yield* Effect.fail(unchecked(connection.name, issues));
    }
    const read = readAddition(connection, checking, yield* givenOf(serving));
    if (Result.isFailure(read)) {
      return yield* Effect.fail(unchecked(connection.name, read.failure));
    }
    const settings = Option.getOrThrow(Option.liftPredicate(read.success, isConnectionServerSettings));
    const reaches = (url: string): string | undefined =>
      hostRefusalOf(policy.allowedHosts, new URL(url).hostname)?.detail;
    return { settings, reaches };
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
  return {
    takesConnections: services.policy.peopleMayAdd,
    connectionsOf: (org) =>
      Effect.map(services.registry.load(connectionsStreamOfOrg(org), connectionsFold), ({ state }) =>
        newestFirst(state)
          .filter((kept) => kept.connection.status !== 'removed')
          .map((kept) => orgConnectionOf({ org, kept, services })),
      ),
  };
}
