import type { JsonObject } from '../dsl/json.ts';
import type { FilterVerdict } from './event-filter.ts';
import { filterTestingOf, type FilterSandbox, type FilterTesting, type MatchedFilter } from './filter-verdicts.ts';

export interface JudgedEvent {
  readonly event: JsonObject;
  readonly now: number;
}

export type PageVerdicts = readonly (readonly FilterVerdict[])[];

export interface PageFilters {
  readonly verdictsOf: (filters: readonly MatchedFilter[], events: readonly JudgedEvent[]) => Promise<PageVerdicts>;
}

function isStopped(verdicts: readonly FilterVerdict[]): boolean {
  return verdicts.some((verdict) => typeof verdict === 'object' && verdict.stopped);
}

async function verdictsFrom(testing: FilterTesting, events: readonly JudgedEvent[]): Promise<PageVerdicts> {
  const [judged, ...rest] = events;
  if (judged === undefined) {
    return [];
  }
  const verdicts = await testing.verdictsOf(judged.event, judged.now);
  return isStopped(verdicts) ? [verdicts] : [verdicts, ...(await verdictsFrom(testing, rest))];
}

export async function pageVerdictsOf(
  filters: readonly MatchedFilter[],
  events: readonly JudgedEvent[],
  sandbox: FilterSandbox,
): Promise<PageVerdicts> {
  const testing = filterTestingOf(filters, sandbox);
  try {
    return await verdictsFrom(testing, events);
  } finally {
    await testing.close();
  }
}

export function pageFiltersOn(sandbox: FilterSandbox): PageFilters {
  return { verdictsOf: (filters, events) => pageVerdictsOf(filters, events, sandbox) };
}
