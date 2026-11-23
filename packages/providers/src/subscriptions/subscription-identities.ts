import { renderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import type { PlaybookAddress } from '@on.auto/operations';
import type { ConnectionWays } from '@on.auto/tool-servers';
import { Clock, Effect, Option, Result, type Schema } from 'effect';

import { answeredIn, identifiedIn } from './subscription-answers.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import { failedBecause, type SubscriptionCallFailed } from './subscription-failed.ts';
import type {
  Identification,
  Identity,
  LoopConnection,
  SubscriptionCalls,
  SubscriptionLoopPorts,
} from './subscription-ports.ts';

type Owing = LoopConnection & { readonly identify: Identity; readonly connected: string };

type ReadFailure = Pick<SubscriptionCallFailed, 'kind' | 'because'>;

interface IdentitiesRead {
  readonly unread: ReadonlyMap<string, ReadFailure>;
  readonly cutAt?: number;
}

type IdentityPorts = Pick<SubscriptionLoopPorts, 'identified'>;

type IdentitiesReading = (
  playbook: PlaybookAddress,
  connections: readonly LoopConnection[],
  deadline?: number,
) => Effect.Effect<IdentitiesRead>;

type AskingATool = Identity & { readonly tool: string };

/** A connection that owes its account, whose entry asks a tool of the connection for it. */
export interface OwedAsTheConnection {
  readonly id: string;
  readonly connection: string;
  readonly connected: string;
  readonly identify: AskingATool;
}

type IdentitiesReadingAsTheConnection = (
  org: string,
  connections: readonly OwedAsTheConnection[],
  deadline?: number,
) => Effect.Effect<IdentitiesRead>;

type ReadOne<Owed> = (owed: Owed) => Effect.Effect<Option.Option<ReadFailure>>;

function owesItsIdentity(connection: LoopConnection): connection is Owing {
  return connection.identify !== undefined && connection.connected !== undefined;
}

export function asksATool(identity: Identity | undefined): identity is AskingATool {
  return identity?.tool !== undefined;
}

function recordedOr(
  identifying: Effect.Effect<Identification, SubscriptionCallFailed>,
  recorded: (identification: Identification) => Effect.Effect<void>,
): Effect.Effect<Option.Option<ReadFailure>> {
  return Effect.matchEffect(identifying, {
    onFailure: ({ kind, because }: ReadFailure) => Effect.succeed(Option.some({ kind, because })),
    onSuccess: (identification) => Effect.as(recorded(identification), Option.none()),
  });
}

function readOf(ports: IdentityPorts, calls: Pick<SubscriptionCalls, 'identify'>, playbook: PlaybookAddress) {
  return (owing: Owing): Effect.Effect<Option.Option<ReadFailure>> => {
    const place = { ...playbook, connection: owing.connection };
    return recordedOr(calls.identify({ identity: owing.identify, place }), (identification) =>
      ports.identified(playbook, owing, identification),
    );
  };
}

export function isPast(deadline: number | undefined): Effect.Effect<number | undefined> {
  if (deadline === undefined) {
    return Effect.undefined;
  }
  return Effect.map(Clock.currentTimeMillis, (at) => (at >= deadline ? at : undefined));
}

function eachReadBefore<Owed extends { readonly connection: string }>(
  owing: readonly Owed[],
  read: ReadOne<Owed>,
  deadline: number | undefined,
): Effect.Effect<IdentitiesRead> {
  return Effect.gen(function* () {
    const unread = new Map<string, ReadFailure>();
    for (const owed of owing) {
      const cutAt = yield* isPast(deadline);
      if (cutAt !== undefined) {
        return { unread, cutAt };
      }
      const failure = yield* read(owed);
      if (Option.isSome(failure)) {
        unread.set(owed.connection, failure.value);
      }
    }
    return { unread };
  });
}

export function identitiesReadWith(
  ports: IdentityPorts,
  calls: Pick<SubscriptionCalls, 'identify'>,
): IdentitiesReading {
  return (playbook, connections, deadline) =>
    eachReadBefore(
      connections.filter((each) => owesItsIdentity(each)),
      readOf(ports, calls, playbook),
      deadline,
    );
}

export function identitiesReadOf(ports: SubscriptionLoopPorts): IdentitiesReading {
  return identitiesReadWith(ports, subscriptionCallsOf(ports));
}

type AsTheConnectionPorts = Pick<SubscriptionLoopPorts, 'identified' | 'mostRequestBytesTo'>;

function answeredAsTheConnection(
  { mostRequestBytesTo }: AsTheConnectionPorts,
  { callAsTheConnection }: ConnectionWays,
  org: string,
  { id, connection, identify: { tool, with: given = {} } }: OwedAsTheConnection,
): Effect.Effect<Schema.Json | undefined, SubscriptionCallFailed> {
  return Effect.gen(function* () {
    const rendered = renderedArguments(given, {}, yield* renderClock, mostRequestBytesTo(connection));
    if (Result.isFailure(rendered)) {
      return yield* failedBecause('not_sent');
    }
    const called = yield* callAsTheConnection({ org, connection: id, tool, input: rendered.success.input });
    return called === undefined ? yield* failedBecause('tool_server_not_configured') : yield* answeredIn(called);
  });
}

/**
 * The accounts connections owe, each asked once of the service as the connection itself, as the chat calls it, with
 * no playbook: the account is the connection's own, as its socket is. Each answer is recorded through the same port
 * a playbook's read records it through.
 */
export function identitiesReadAsTheConnection(
  ports: AsTheConnectionPorts,
  ways: ConnectionWays,
): IdentitiesReadingAsTheConnection {
  return (org, connections, deadline) =>
    eachReadBefore(
      connections,
      (owed) =>
        recordedOr(
          Effect.flatMap(answeredAsTheConnection(ports, ways, org, owed), (document) =>
            identifiedIn(document, owed.identify),
          ),
          (identification) => ports.identified({ org }, owed, identification),
        ),
      deadline,
    );
}
