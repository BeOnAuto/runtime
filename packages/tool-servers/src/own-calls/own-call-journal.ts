import {
  messageIdOf,
  type Decided,
  type Decider,
  type Lineage,
  type Recorded,
  type StreamWriter,
} from '@on.auto/operations';
import { DateTime, Effect, Exit, Ref } from 'effect';

import type { CallEnded, CallStarted } from '../calls/call-facts.ts';
import type { CallJournal } from '../calls/recorded-calls.ts';
import type { OwnCall, OwnCallTurn } from './own-call-decider.ts';

export interface OwnCallKind<Event extends Recorded> {
  readonly decider: Decider<OwnCallTurn<Event>, OwnCall<Event>, Event, 'conflict'>;
  readonly started: (fact: CallStarted) => Decided<Event>;
  readonly ended: (fact: CallEnded) => Decided<Event>;
}

export interface OwnCallPlace {
  readonly writer: Pick<StreamWriter, 'execute'>;
  readonly stream: string;
  readonly inThePlaybook: string;
  readonly by: string;
  readonly lineage: Lineage;
}

const theOnlyCall = 1;

export function ownCallJournal<Event extends Recorded>(kind: OwnCallKind<Event>, place: OwnCallPlace): CallJournal {
  const startId = Ref.makeUnsafe<string | null>(null);
  const appended = (event: Decided<Event>, causationId: string | null) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      const { version } = yield* place.writer.execute(
        place.stream,
        kind.decider,
        { event, context: { at, by: place.by } },
        { ...place.lineage, causationId },
      );
      return messageIdOf(place.inThePlaybook, version);
    });
  return {
    started: (fact) =>
      appended(kind.started(fact), place.lineage.causationId).pipe(
        Effect.orDie,
        Effect.flatMap((id) => Ref.set(startId, id)),
        Effect.as(theOnlyCall),
      ),
    ended: (_number, fact) =>
      Effect.flatMap(Ref.get(startId), (causationId) =>
        appended(kind.ended(fact), causationId).pipe(Effect.exit, Effect.map(Exit.isSuccess)),
      ),
  };
}
