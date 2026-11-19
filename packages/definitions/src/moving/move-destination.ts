import { Conflict, type PlaybookAddress, type PlaybookReader } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { refusedToAnswerFor } from '../operations/unread-texts.ts';
import { textRead } from '../payloads/kept-texts.ts';
import { serversNamedBy } from '../portable/portable-export.ts';
import type { Member } from './move-members.ts';
import { connectionNotAccessibleWords, takenWords, type Named } from './move-words.ts';

export interface ConnectionAccess {
  readonly hasAccess: (playbook: PlaybookAddress, connection: string) => Effect.Effect<boolean>;
}

export function takenRefused(
  to: PlaybookReader['Service'],
  playbook: string,
  members: readonly Member[],
): Effect.Effect<void, Conflict> {
  return Effect.forEach(
    members,
    (member) =>
      Effect.flatMap(to.holderOfName(member.type, member.name), (holder) =>
        holder === undefined
          ? Effect.void
          : Effect.fail(
              new Conflict({ detail: takenWords(playbook, member, holder.status === 'retired'), kind: 'taken' }),
            ),
      ),
    { discard: true },
  );
}

interface ANeed extends Named {
  readonly connection: string;
}

interface Needed {
  readonly connection: string;
  readonly user: Named;
  readonly definitions: readonly Named[];
}

function connectionsNamedBy({ type, name, stored }: Member) {
  return textRead('source', stored.source).pipe(
    Effect.mapError(refusedToAnswerFor(type, stored)),
    Effect.map((source) =>
      [...new Set(serversNamedBy({ type, source }))].map((connection): ANeed => ({ connection, type, name })),
    ),
  );
}

function neededOf(needs: readonly ANeed[]): readonly Needed[] {
  const order = [...new Set(needs.map(({ connection }) => connection))].toSorted();
  return needs
    .filter((need, index) => needs.findIndex(({ connection }) => connection === need.connection) === index)
    .map(({ connection, type, name }): Needed => ({
      connection,
      user: { type, name },
      definitions: needs.filter((need) => need.connection === connection),
    }))
    .toSorted((one, other) => order.indexOf(one.connection) - order.indexOf(other.connection));
}

function connectionRefusal(to: PlaybookAddress, lacking: readonly Needed[]): Conflict | undefined {
  const [first] = lacking;
  return first === undefined
    ? undefined
    : new Conflict({
        detail: connectionNotAccessibleWords(to.playbook, first.connection, first.user),
        kind: 'connection_not_accessible',
        record: {
          connections: lacking.map(({ connection, definitions }) => ({
            connection,
            definitions: definitions.map(({ type, name }) => ({ type, name })),
          })),
        },
      });
}

export function connectionsRefused(access: ConnectionAccess, to: PlaybookAddress, members: readonly Member[]) {
  return Effect.gen(function* () {
    const needs = (yield* Effect.forEach(members, connectionsNamedBy)).flat();
    const lacking = yield* Effect.filter(neededOf(needs), ({ connection }) =>
      Effect.map(access.hasAccess(to, connection), (has) => !has),
    );
    return yield* Option.match(Option.fromNullishOr(connectionRefusal(to, lacking)), {
      onNone: () => Effect.void,
      onSome: Effect.fail,
    });
  });
}
