import {
  connectionPublicationOf,
  type RecordConnectionEvent,
  type ReportedEvent,
} from '@on.auto/definitions/connection-events';
import type { ReadSavedTriggers, SavedEventTrigger } from '@on.auto/definitions/connection-triggers';
import {
  streamPrefixOfDefinition,
  streamPrefixOfPlaybook,
  type Conflict,
  type PlaybookAddress,
  type PlaybookRegistry,
} from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { filterMatchingOf, type MatchFilters } from '../filtering/filter-matching.ts';
import { judgementOf, namingTheConnection, type JudgedTrigger, type Judging } from './trigger-judgements.ts';
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
  readonly registry: PlaybookRegistry['Service'];
  readonly savedTriggers: ReadSavedTriggers;
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

type SavedTriggersRefused = Effect.Error<ReturnType<ReadSavedTriggers>>;

export type TakeIn = (arrival: ConnectionArrival) => Effect.Effect<IntakeAnswer, Conflict | SavedTriggersRefused>;

const taken: IntakeAnswer = { outcome: 'taken' };

const refused: IntakeAnswer = { outcome: 'refused' };

const playbookRetired: IntakeAnswer = { outcome: 'not_taken', reasons: ['playbook_retired'] };

function reasonsOf(outcomes: readonly TriggerOutcome[]): readonly NotTakenReason[] {
  return notTakenReasons.filter((reason) => outcomes.some((outcome) => outcome.reason === reason));
}

function judgedIn(playbook: PlaybookAddress, saved: readonly SavedEventTrigger[]): readonly JudgedTrigger[] {
  return saved.map(({ definition, reference, filters }) => ({
    definitionKey: streamPrefixOfDefinition({ org: playbook.org, definition }),
    reference,
    filters,
  }));
}

function outcomesOfTheTriggers(
  judging: Judging,
  triggers: readonly JudgedTrigger[],
): Effect.Effect<readonly TriggerOutcome[] | 'taken'> {
  return Effect.gen(function* () {
    const outcomes: TriggerOutcome[] = [];
    for (const trigger of triggers) {
      const judgement = yield* judgementOf(judging, trigger);
      if (judgement === 'takes') {
        return 'taken' as const;
      }
      outcomes.push(judgement);
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
  const { database, servedConnection, registry, savedTriggers, record, match } = parts;
  return (arrival) =>
    Effect.gen(function* () {
      const { playbook, connection, event } = arrival;
      const served = yield* servedConnection(playbook, connection);
      if (served === undefined) {
        return refused;
      }
      if ((yield* registry.status(playbook)) === 'retired') {
        return playbookRetired;
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
      const naming = namingTheConnection(judged.type, judged);
      const triggers = judgedIn(playbook, yield* savedTriggers(playbook, naming));
      const outcomes = yield* outcomesOfTheTriggers({ match, naming, event: judged, now }, triggers);
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
