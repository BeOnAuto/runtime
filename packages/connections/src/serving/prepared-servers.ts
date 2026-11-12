import { isConnectionServerSettings, type ConnectionServer, type ConnectionUnready } from '@on.auto/tool-servers';
import { Effect, Option, Result } from 'effect';

import { documentTextOf } from '../documents/kept-documents.ts';
import { entryIssuesOf, readAddition } from '../entries/entry-checks.ts';
import { reachesUnder, useRefusalOf } from '../policy/policy-rules.ts';
import { providingOf } from '../providers/provider-additions.ts';
import { consentAuthOf, credentialRefusedOf, givenOf, notAllowed } from './given-credentials.ts';
import type { Serving } from './serving-services.ts';
import { servingWords } from './serving-words.ts';

function unchecked(name: string, issues: ReturnType<typeof entryIssuesOf>): ConnectionUnready {
  return notAllowed(
    servingWords.unchecked(
      name,
      issues.map(({ detail }) => detail),
    ),
  );
}

export function preparedServer(serving: Serving): Effect.Effect<ConnectionServer, ConnectionUnready> {
  const { policy, modelProviders } = serving.services;
  const { connection } = serving.kept;
  const { document } = connection;
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
    const documentText =
      document === undefined
        ? undefined
        : yield* documentTextOf(serving.services.registry, serving.org, { name: connection.name, document });
    const given = yield* givenOf(serving);
    const auth = yield* consentAuthOf(serving, checking.providing);
    const read = readAddition({ ...connection, documentText }, checking, given);
    if (Result.isFailure(read)) {
      return yield* Effect.fail(unchecked(connection.name, read.failure));
    }
    const settings = Option.getOrThrow(Option.liftPredicate(read.success, isConnectionServerSettings));
    return {
      settings: auth === undefined ? settings : { ...settings, auth },
      reaches: reachesUnder(policy, serving.services.resolve),
      refused: credentialRefusedOf(serving, yield* Effect.context()),
    };
  });
}
