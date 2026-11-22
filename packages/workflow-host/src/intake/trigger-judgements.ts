import type { ChosenFilter, SavedEventTrigger } from '@on.auto/definitions/connection-triggers';
import {
  connectionMarks,
  filterMayTake,
  type FilterVerdict,
  type Json,
  type JsonObject,
} from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { MatchFilters } from '../filtering/filter-matching.ts';
import type { TriggerOutcome } from './trigger-outcomes.ts';

export type Judgement = 'takes' | TriggerOutcome;

export interface JudgedTrigger extends Pick<SavedEventTrigger, 'reference' | 'filters'> {
  readonly definitionKey: string;
}

export interface Judging {
  readonly match: MatchFilters;
  readonly naming: ChosenFilter;
  readonly event: JsonObject;
  readonly now: number;
  readonly ownUntold: boolean;
}

function withoutThe(marks: readonly string[], event: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(event).filter(([attribute]: readonly [string, Json]) => !marks.includes(attribute)),
  );
}

const automaticMark: readonly string[] = ['automatic'];

export function namingTheConnection(type: string, event: JsonObject): ChosenFilter {
  const asked = withoutThe(connectionMarks, event);
  return (filter) => filter.type === type && filterMayTake(filter.attributes, asked);
}

function mayStillMatch(verdict: FilterVerdict): boolean {
  return verdict === true || (typeof verdict === 'object' && verdict.stopped);
}

function failed(verdict: FilterVerdict): boolean {
  return typeof verdict === 'object';
}

function notAskedFor(naming: JudgedTrigger['filters'], event: JsonObject): TriggerOutcome['reason'] {
  const butForItsAutomaticMark = withoutThe(automaticMark, event);
  return naming.some(({ attributes }) => filterMayTake(attributes, butForItsAutomaticMark))
    ? 'automatic_not_asked'
    : 'own_not_asked';
}

export function judgementOf(judging: Judging, trigger: JudgedTrigger): Effect.Effect<Judgement> {
  const { event, match, now } = judging;
  const outcome = (reason: TriggerOutcome['reason']): TriggerOutcome => ({
    definitionKey: trigger.definitionKey,
    reference: trigger.reference,
    reason,
  });
  if (judging.ownUntold) {
    return Effect.succeed(outcome('connection_unidentified'));
  }
  const naming = trigger.filters.filter(judging.naming);
  if (!naming.some(({ attributes }) => filterMayTake(attributes, event))) {
    return Effect.succeed(outcome(notAskedFor(naming, event)));
  }
  return Effect.map(match(naming, event, now), (verdicts): Judgement => {
    if (verdicts.some((verdict) => mayStillMatch(verdict))) {
      return 'takes';
    }
    return outcome(verdicts.some((verdict) => failed(verdict)) ? 'filter_failed' : 'filtered');
  });
}
