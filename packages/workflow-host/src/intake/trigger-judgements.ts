import { filterMayTake, type FilterVerdict, type Json, type JsonObject } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { MatchFilters } from '../filtering/filter-matching.ts';
import { eventSubscriptionsOf, type EventSubscription } from '../triggers/trigger-rows.ts';
import type { TriggerOutcome } from './trigger-outcomes.ts';

export type Judgement = 'takes' | 'not_named' | TriggerOutcome;

export interface Judging {
  readonly database: HostDatabase;
  readonly match: MatchFilters;
  readonly playbookKey: string;
  readonly type: string;
  readonly event: JsonObject;
  readonly now: number;
}

const triggersAPage = 100;

function triggersFrom(judging: Judging, after?: string): Effect.Effect<readonly EventSubscription[]> {
  const { database, playbookKey, type } = judging;
  return Effect.flatMap(eventSubscriptionsOf(database, playbookKey, { type, after, most: triggersAPage }), (rows) => {
    const page = rows.slice(0, triggersAPage);
    const last = page.at(-1);
    return rows.length > triggersAPage && last !== undefined
      ? Effect.map(triggersFrom(judging, last.definitionKey), (rest) => [...page, ...rest])
      : Effect.succeed(page);
  });
}

export function triggersOfItsType(judging: Judging): Effect.Effect<readonly EventSubscription[]> {
  return triggersFrom(judging);
}

function unmarked(event: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(event).filter(([attribute]: readonly [string, Json]) => attribute !== 'automatic'),
  );
}

function mayStillMatch(verdict: FilterVerdict): boolean {
  return verdict === true || (typeof verdict === 'object' && verdict.stopped);
}

function failed(verdict: FilterVerdict): boolean {
  return typeof verdict === 'object';
}

export function judgementOf(judging: Judging, trigger: EventSubscription): Effect.Effect<Judgement> {
  const { event, match, now } = judging;
  const outcome = (reason: TriggerOutcome['reason']): TriggerOutcome => ({
    definitionKey: trigger.definitionKey,
    reference: trigger.reference,
    reason,
  });
  const naming = trigger.filters.filter(({ attributes }) => filterMayTake(attributes, unmarked(event)));
  if (naming.length === 0) {
    return Effect.succeed('not_named');
  }
  if (!naming.some(({ attributes }) => filterMayTake(attributes, event))) {
    return Effect.succeed(outcome('automatic_not_asked'));
  }
  return Effect.map(match(naming, event, now), (verdicts): Judgement => {
    if (verdicts.some((verdict) => mayStillMatch(verdict))) {
      return 'takes';
    }
    return outcome(verdicts.some((verdict) => failed(verdict)) ? 'filter_failed' : 'filtered');
  });
}
