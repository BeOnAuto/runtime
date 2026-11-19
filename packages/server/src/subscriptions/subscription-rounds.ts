import { holdsASubscription, playbooksDueOf, reconcileDueAfter, type DueLedger } from '@on.auto/connections';
import type { RecordWork, Work } from '@on.auto/definitions';
import { requestPlaceFacts } from '@on.auto/interaction';
import {
  playbookOfStreamPrefix,
  type PlaybookAddress,
  type ProjectionReader,
  type RecordedEvent,
} from '@on.auto/operations';
import type { Consumer, DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

const subscriptionRoundsName = 'the subscriptions of the playbooks';

const runEndings: readonly string[] = ['run_succeeded', 'run_rejected', 'run_failed'];

interface RoundsParts {
  readonly round: (playbook: PlaybookAddress, now: number) => Effect.Effect<void>;
  readonly ledger: DueLedger & Pick<ProjectionReader, 'readProjectedRows'>;
  readonly arrangesAWay: boolean;
}

export interface FactFollowed {
  readonly playbook: PlaybookAddress;
  readonly record: Pick<RecordedEvent, 'id' | 'context'>;
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

function roundOf(parts: RoundsParts, owed: OwedRounds, playbook: PlaybookAddress, now: number): Effect.Effect<void> {
  return Effect.suspend(() => {
    const before = owed.askedOf(playbook);
    return Effect.map(parts.round(playbook, now), () => {
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

function wantedIn(parts: RoundsParts, playbookKey: string): Effect.Effect<boolean> {
  if (parts.arrangesAWay) {
    return Effect.succeed(true);
  }
  return Option.match(playbookOfStreamPrefix(playbookKey), {
    onNone: () => Effect.succeed(false),
    onSome: (playbook) => holdsASubscription(parts.ledger, playbook),
  });
}

function consumerOf(parts: RoundsParts, owed: OwedRounds): FactsConsumer {
  return {
    name: subscriptionRoundsName,
    types: runEndings,
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    wants: (playbookKey) => wantedIn(parts, playbookKey),
    batchOf: ({ playbook, record }, after) =>
      Effect.succeed(
        after === undefined
          ? {
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
            }
          : { deliveries: [], through: after, more: false },
      ),
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
  };
}
