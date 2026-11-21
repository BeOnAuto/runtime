import {
  connectionPublicationOf,
  type RecordConnectionEvent,
  type ReportedEvent,
} from '@on.auto/definitions/connection-events';
import { streamPrefixOfPlaybook, type Conflict, type PlaybookAddress } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { filterMatchingOf, type MatchFilters } from '../filtering/filter-matching.ts';
import { judgementOf, triggersOfItsType, type Judging } from './trigger-judgements.ts';
import {
  beforeAnyTrigger,
  notTakenReasons,
  outcomesCounted,
  type NotTakenReason,
  type TriggerOutcome,
} from './trigger-outcomes.ts';

export interface ConnectionArrival {
  readonly playbook: PlaybookAddress;
  readonly connection: string;
  readonly event: ReportedEvent;
  readonly topic?: string;
}

export interface ServedConnection {
  readonly topicsOf: (event: Pick<ReportedEvent, 'type' | 'subject'>) => Effect.Effect<readonly string[]>;
}

export interface IntakePorts {
  readonly servedConnection: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ServedConnection | undefined>;
  readonly record: RecordConnectionEvent;
}

export interface IntakeParts extends IntakePorts {
  readonly database: HostDatabase;
  readonly filters: FilterSandbox;
  readonly now: () => number;
}

interface MatchingParts extends IntakePorts {
  readonly database: HostDatabase;
  readonly match: MatchFilters;
  readonly now: () => number;
}

export type IntakeAnswer =
  | { readonly outcome: 'taken' }
  | { readonly outcome: 'not_taken'; readonly reasons: readonly NotTakenReason[] }
  | { readonly outcome: 'refused' };

export type TakeIn = (arrival: ConnectionArrival) => Effect.Effect<IntakeAnswer, Conflict>;

const taken: IntakeAnswer = { outcome: 'taken' };

const refused: IntakeAnswer = { outcome: 'refused' };

function reasonsOf(outcomes: readonly TriggerOutcome[]): readonly NotTakenReason[] {
  return notTakenReasons.filter((reason) => outcomes.some((outcome) => outcome.reason === reason));
}

function outcomesOfTheTriggers(judging: Judging): Effect.Effect<readonly TriggerOutcome[] | 'taken'> {
  return Effect.gen(function* () {
    const outcomes: TriggerOutcome[] = [];
    for (const trigger of yield* triggersOfItsType(judging)) {
      const judgement = yield* judgementOf(judging, trigger);
      if (judgement === 'takes') {
        return 'taken' as const;
      }
      if (judgement !== 'not_named') {
        outcomes.push(judgement);
      }
    }
    return outcomes.length === 0 ? [beforeAnyTrigger('no_trigger')] : outcomes;
  });
}

function isOutOfItsTopic(served: ServedConnection, { event, topic }: ConnectionArrival): Effect.Effect<boolean> {
  return topic === undefined
    ? Effect.succeed(false)
    : Effect.map(served.topicsOf(event), (topics) => !topics.includes(topic));
}

export function intakeMatching(parts: MatchingParts): TakeIn {
  const { database, servedConnection, record, match } = parts;
  return (arrival) =>
    Effect.gen(function* () {
      const { playbook, connection, event } = arrival;
      const served = yield* servedConnection(playbook, connection);
      if (served === undefined) {
        return refused;
      }
      const now = parts.now();
      const at = new Date(now).toISOString();
      const playbookKey = streamPrefixOfPlaybook(playbook);
      const notTaken = (outcomes: readonly TriggerOutcome[]) =>
        Effect.as(outcomesCounted(database, playbookKey, outcomes, now), {
          outcome: 'not_taken' as const,
          reasons: reasonsOf(outcomes),
        });
      if (yield* isOutOfItsTopic(served, arrival)) {
        return yield* notTaken([beforeAnyTrigger('topic_mismatch')]);
      }
      const publication = connectionPublicationOf(connection, event, at);
      if (publication === undefined) {
        return yield* notTaken([beforeAnyTrigger('invalid_event')]);
      }
      const { event: judged } = publication;
      const judging = { database, match, playbookKey, type: judged.type, event: judged, now };
      const outcomes = yield* outcomesOfTheTriggers(judging);
      if (outcomes === 'taken') {
        yield* record(playbook, publication, at);
        return taken;
      }
      return yield* notTaken(outcomes);
    });
}

export function connectionEventIntakeOf({ filters, ...parts }: IntakeParts): TakeIn {
  return intakeMatching({ ...parts, match: filterMatchingOf(filters) });
}
