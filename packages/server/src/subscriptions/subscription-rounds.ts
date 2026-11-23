import {
  listensThroughAConnection,
  playbooksDueOf,
  reconcileDueAfter,
  type DueLedger,
  type ListeningParts,
} from '@on.auto/connections';
import type { RecordWork, Work } from '@on.auto/definitions';
import { changesConnectionTriggers, connectionTriggerFacts } from '@on.auto/definitions/connection-triggers';
import { requestPlaceFacts } from '@on.auto/interaction';
import type { PlaybookAddress, ProjectionReader, RecordedEvent } from '@on.auto/operations';
import type { ConnectionTrigger, LoopConnection, Reconciled, TakeListed, TakenIn } from '@on.auto/providers';
import type { Consumer, DueItem, DueWork, IntakeAnswer, TakeIn } from '@on.auto/workflow-host';
import { Effect, type Cause } from 'effect';

const subscriptionRoundsName = 'the subscriptions of the playbooks';

const runEndings: readonly string[] = ['run_succeeded', 'run_rejected', 'run_failed'];

interface RoundsParts {
  readonly round: (playbook: PlaybookAddress, now: number) => Effect.Effect<Reconciled>;
  readonly ledger: DueLedger & Pick<ProjectionReader, 'readProjectedRows'>;
  readonly arrangesAWay: boolean;
  readonly triggersIn: ListeningParts['triggersIn'];
  readonly connectionsOf: (playbook: PlaybookAddress) => Effect.Effect<readonly LoopConnection[]>;
  readonly namesRead: (
    playbook: PlaybookAddress,
    connections: readonly LoopConnection[],
    triggers: readonly ConnectionTrigger[],
  ) => Effect.Effect<void>;
}

export interface FactFollowed {
  readonly playbook: PlaybookAddress;
  readonly record: Pick<RecordedEvent, 'id' | 'type' | 'context'>;
}

interface OwedDelivery {
  readonly key: string;
  readonly workflow: string;
  readonly deliver: Effect.Effect<void>;
  readonly skipped: () => Effect.Effect<void>;
}

interface OwedBatch {
  readonly deliveries: readonly OwedDelivery[];
  readonly through: string | undefined;
  readonly more: boolean;
}

interface FactsConsumer extends Omit<Consumer, 'batchOf' | 'wants'> {
  readonly wants: (playbookKey: string) => Effect.Effect<boolean>;
  readonly batchOf: (followed: FactFollowed, after: string | undefined, most: number) => Effect.Effect<OwedBatch>;
}

export interface SubscriptionRounds {
  readonly dueWork: DueWork;
  readonly consumer: FactsConsumer;
  readonly recording: (record: RecordWork) => RecordWork;
  readonly asked: (playbook: PlaybookAddress) => void;
}

interface Owed {
  readonly playbook: PlaybookAddress;
  readonly asked: number;
}

function keyOf({ org, playbook }: PlaybookAddress): string {
  return JSON.stringify([org, playbook]);
}

interface OwedRounds {
  readonly ask: (playbook: PlaybookAddress) => void;
  readonly now: () => readonly PlaybookAddress[];
  readonly askedOf: (playbook: PlaybookAddress) => number | undefined;
  readonly answered: (playbook: PlaybookAddress, before: number | undefined) => void;
}

function owedRoundsOf(): OwedRounds {
  const owed = new Map<string, Owed>();
  const asking = { asked: 0 };
  return {
    ask: (playbook) => {
      asking.asked += 1;
      owed.set(keyOf(playbook), { playbook: { org: playbook.org, playbook: playbook.playbook }, asked: asking.asked });
    },
    now: () => [...owed.values()].map(({ playbook }) => playbook),
    askedOf: (playbook) => owed.get(keyOf(playbook))?.asked,
    answered: (playbook, before) => {
      if (owed.get(keyOf(playbook))?.asked === before) {
        owed.delete(keyOf(playbook));
      }
    },
  };
}

function namesReadAfter(parts: RoundsParts, playbook: PlaybookAddress): Effect.Effect<void> {
  return Effect.gen(function* () {
    const connections = yield* parts.connectionsOf(playbook);
    const triggers = yield* parts.triggersIn(playbook);
    yield* parts.namesRead(playbook, connections, triggers);
  });
}

function roundOf(parts: RoundsParts, owed: OwedRounds, playbook: PlaybookAddress, now: number): Effect.Effect<void> {
  return Effect.suspend(() => {
    const before = owed.askedOf(playbook);
    const round = Effect.tap(parts.round(playbook, now), () => namesReadAfter(parts, playbook));
    return Effect.map(round, () => {
      owed.answered(playbook, before);
    });
  });
}

function itemsOf(parts: RoundsParts, owed: OwedRounds, due: readonly PlaybookAddress[]): readonly DueItem[] {
  return [...owed.now(), ...due].map((playbook) => ({
    key: keyOf(playbook),
    callsOut: true,
    perform: (now: number) => roundOf(parts, owed, playbook, now),
  }));
}

function dueWorkOf(parts: RoundsParts, owed: OwedRounds): DueWork {
  return {
    name: subscriptionRoundsName,
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.map(playbooksDueOf(parts.ledger, now, most), (due) => itemsOf(parts, owed, due))
        : Effect.succeed([]),
    nextDueAt: (after, callsOut = true) => (callsOut ? reconcileDueAfter(parts.ledger, after) : Effect.succeed(null)),
  };
}

export function noRequestSent(): Effect.Effect<boolean> {
  return Effect.succeed(false);
}

function wantedInEveryPlaybook(): Effect.Effect<boolean> {
  return Effect.succeed(true);
}

function owesARound(record: FactFollowed['record']): boolean {
  return runEndings.includes(record.type) || changesConnectionTriggers(record);
}

function roundOwedFor(parts: RoundsParts, { playbook, record }: FactFollowed): Effect.Effect<boolean> {
  if (!owesARound(record)) {
    return Effect.succeed(false);
  }
  if (parts.arrangesAWay) {
    return Effect.succeed(true);
  }
  const { ledger, triggersIn } = parts;
  return listensThroughAConnection({ ledger, sentIn: noRequestSent, triggersIn }, playbook);
}

function owedBatchOf(owed: OwedRounds, { playbook, record }: FactFollowed): OwedBatch {
  return {
    deliveries: [
      {
        key: record.id,
        workflow: record.context.definitionName ?? '',
        deliver: Effect.sync(() => {
          owed.ask(playbook);
        }),
        skipped: () => Effect.void,
      },
    ],
    through: record.id,
    more: false,
  };
}

function nothingOwedAfter(after: string | undefined): OwedBatch {
  return { deliveries: [], through: after, more: false };
}

function consumerOf(parts: RoundsParts, owed: OwedRounds): FactsConsumer {
  return {
    name: subscriptionRoundsName,
    types: [...runEndings, ...connectionTriggerFacts],
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    wants: wantedInEveryPlaybook,
    batchOf: (followed, after) =>
      after === undefined
        ? Effect.map(roundOwedFor(parts, followed), (owes) =>
            owes ? owedBatchOf(owed, followed) : nothingOwedAfter(after),
          )
        : Effect.succeed(nothingOwedAfter(after)),
  };
}

function movesARequest(work: Work): boolean {
  return work.type === 'answer' || requestPlaceFacts.includes(work.fact.type);
}

function recordingOf(owed: OwedRounds): SubscriptionRounds['recording'] {
  return (record) => (run, work, lineage, rule) =>
    Effect.tap(record(run, work, lineage, rule), () =>
      Effect.sync(() => {
        if (movesARequest(work)) {
          owed.ask(run);
        }
      }),
    );
}

function recordedAsItIs(record: RecordWork): RecordWork {
  return record;
}

export function subscriptionRoundsOf(parts: RoundsParts): SubscriptionRounds {
  const owed = owedRoundsOf();
  return {
    dueWork: dueWorkOf(parts, owed),
    consumer: consumerOf(parts, owed),
    recording: parts.arrangesAWay ? recordingOf(owed) : recordedAsItIs,
    asked: owed.ask,
  };
}

function takenAs({ outcome }: IntakeAnswer): TakenIn {
  return outcome === 'refused' ? 'held' : outcome;
}

export function listedIntakeOf(takeIn: TakeIn): TakeListed {
  return (arrival) =>
    takeIn(arrival).pipe(
      Effect.tapCause((cause: Cause.Cause<unknown>) =>
        Effect.logWarning('An item a check listed was not taken in; it is read again later', cause),
      ),
      Effect.match({ onFailure: (): TakenIn => 'held', onSuccess: takenAs }),
    );
}
