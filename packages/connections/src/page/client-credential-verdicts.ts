import { Unavailable, type Conflict, type InvalidInput } from '@on.auto/operations';
import type { ConnectionTokensChecked } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import { cannotConnectAsSetUp } from './exchange-checks.ts';
import { appDetailsRefusedWith, refused } from './given-fields.ts';
import { keyFileVerdictOf } from './key-file-verdicts.ts';

type Refusal = InvalidInput | Unavailable | Conflict;

type Undescribed = Extract<ConnectionTokensChecked, { readonly problems: unknown }>;

function undescribedOf(connection: RecordedConnection, { kind, problems }: Undescribed): Refusal {
  const details = problems.map(({ detail }) => detail);
  return kind === 'document_unread'
    ? new Unavailable({ detail: details.join('; ') })
    : cannotConnectAsSetUp(
        connection,
        details.map((detail) => ({ pointer: '', detail })),
      );
}

function loggedWhenUnreached({ name }: RecordedConnection, checked: ConnectionTokensChecked): Effect.Effect<void> {
  return checked.kind === 'unreached'
    ? Effect.logWarning(
        `The client credentials given for the connection ${name} were not checked with its authorization server`,
      )
    : Effect.void;
}

function refusalOf(connection: RecordedConnection, checked: ConnectionTokensChecked): Effect.Effect<void, Refusal> {
  if ('problems' in checked) {
    return Effect.fail(undescribedOf(connection, checked));
  }
  if (checked.kind === 'refused') {
    return Effect.fail(refused([{ pointer: '', detail: appDetailsRefusedWith(checked.code, checked.description) }]));
  }
  const { name, credential, provider, status } = connection;
  const issuer = Option.getOrThrow(Option.fromNullishOr(credential.issuer));
  return keyFileVerdictOf(
    { name, issuer, provider, connected: status === 'connected', throughAGateway: false },
    checked,
  );
}

export function clientCredentialsVerdictOf(
  connection: RecordedConnection,
  checked: ConnectionTokensChecked,
): Effect.Effect<void, Refusal> {
  return Effect.andThen(loggedWhenUnreached(connection, checked), refusalOf(connection, checked));
}
