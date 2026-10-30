import {
  filterVerdictsOf,
  type DslError,
  type FilterSandbox,
  type FilterVerdict,
  type JsonObject,
  type MatchedFilter,
} from '@on.auto/workflow-engine';
import { Array, Effect } from 'effect';

export const stopsInARowBeforeTheVersion = 3;

export type MatchFilters = (
  filters: readonly MatchedFilter[],
  event: JsonObject,
  now: number,
) => Effect.Effect<readonly FilterVerdict[]>;

export interface FilterPlace {
  readonly kind: 'trigger' | 'listener';
  readonly playbookKey: string;
  readonly workflow: string;
  readonly version: number;
  readonly reference: string;
}

type Judgement =
  | { readonly kind: 'answered' }
  | { readonly kind: 'struck' }
  | { readonly kind: 'stopped'; readonly error: DslError };

export interface FilterStops {
  readonly isStopped: (place: FilterPlace, index: number) => boolean;
  readonly judged: (place: FilterPlace, index: number, verdict: FilterVerdict) => Judgement;
  readonly failedFirst: (place: FilterPlace) => boolean;
  readonly holds: (place: FilterPlace) => boolean;
  readonly activated: (playbookKey: string, workflow: string, version: number) => void;
  readonly retired: (playbookKey: string, workflow: string) => void;
  readonly listenerEnded: (place: FilterPlace) => void;
}

interface FilterGroup {
  readonly place: FilterPlace;
  readonly filters: readonly MatchedFilter[];
}

interface GroupMatched {
  readonly verdicts: readonly FilterVerdict[];
  readonly stopped: readonly DslError[];
  readonly struck: boolean;
}

export type MatchGroups = (
  groups: readonly FilterGroup[],
  event: JsonObject,
  now: number,
) => Effect.Effect<readonly GroupMatched[]>;

interface PlacedFilter {
  readonly filter: MatchedFilter;
  readonly index: number;
}

interface Struck {
  readonly place: FilterPlace;
  readonly inARow: number;
}

const answered: Judgement = { kind: 'answered' };

const struck: Judgement = { kind: 'struck' };

function placeKeyOf({ kind, playbookKey, workflow, version, reference }: FilterPlace): string {
  return JSON.stringify([playbookKey, workflow, kind, version, reference]);
}

function filterKeyOf(place: FilterPlace, index: number): string {
  return JSON.stringify([placeKeyOf(place), index]);
}

function ofWorkflow(playbookKey: string, workflow: string): (place: FilterPlace) => boolean {
  return (place) => place.playbookKey === playbookKey && place.workflow === workflow;
}

export function filterStops(): FilterStops {
  const strikes = new Map<string, Struck>();
  const failed = new Map<string, FilterPlace>();
  const forgotten = (forgets: (place: FilterPlace) => boolean): void => {
    for (const [key, { place }] of strikes) {
      if (forgets(place)) {
        strikes.delete(key);
      }
    }
    for (const [key, place] of failed) {
      if (forgets(place)) {
        failed.delete(key);
      }
    }
  };
  return {
    isStopped: (place, index) => (strikes.get(filterKeyOf(place, index))?.inARow ?? 0) >= stopsInARowBeforeTheVersion,
    judged: (place, index, verdict) => {
      const key = filterKeyOf(place, index);
      if (typeof verdict !== 'object' || !verdict.stopped) {
        strikes.delete(key);
        return answered;
      }
      const inARow = (strikes.get(key)?.inARow ?? 0) + 1;
      strikes.set(key, { place, inARow });
      return inARow >= stopsInARowBeforeTheVersion ? { kind: 'stopped', error: verdict.error } : struck;
    },
    failedFirst: (place) => {
      const first = !failed.has(placeKeyOf(place));
      failed.set(placeKeyOf(place), place);
      return first;
    },
    holds: (place) => [...strikes.values()].some((held) => placeKeyOf(held.place) === placeKeyOf(place)),
    activated: (playbookKey, workflow, version) => {
      const ofIt = ofWorkflow(playbookKey, workflow);
      forgotten((place) => ofIt(place) && place.kind === 'trigger' && place.version !== version);
    },
    retired: (playbookKey, workflow) => {
      const ofIt = ofWorkflow(playbookKey, workflow);
      forgotten((place) => ofIt(place) && place.kind === 'trigger');
    },
    listenerEnded: (ended) => {
      forgotten((place) => placeKeyOf(place) === placeKeyOf(ended));
    },
  };
}

export function filterMatchingOf(sandbox: FilterSandbox): MatchFilters {
  return (filters, event, now) => Effect.promise(() => filterVerdictsOf(filters, event, sandbox, now));
}

function groupMatched(verdicts: readonly FilterVerdict[], judgements: readonly Judgement[]): GroupMatched {
  return {
    verdicts,
    stopped: judgements.flatMap((judgement) => (judgement.kind === 'stopped' ? [judgement.error] : [])),
    struck: judgements.some(({ kind }) => kind === 'struck'),
  };
}

export function groupMatchingOf(match: MatchFilters, stops: FilterStops): MatchGroups {
  const matchedGroup = ({ place, filters }: FilterGroup, event: JsonObject, now: number) => {
    const placed = filters
      .map((filter, index): PlacedFilter => ({ filter, index }))
      .filter(({ index }) => !stops.isStopped(place, index));
    const verdicts = match(
      placed.map(({ filter }) => filter),
      event,
      now,
    );
    return Effect.map(verdicts, (answers) =>
      groupMatched(
        answers,
        Array.zipWith(placed, answers, ({ index }, verdict) => stops.judged(place, index, verdict)),
      ),
    );
  };
  return (groups, event, now) => Effect.forEach(groups, (group) => matchedGroup(group, event, now));
}
