import { field, jsonOfText, type Json, type JsonObject } from '../dsl/json.ts';
import { attributeHolds, filterAttributesOf, type FilterAttribute } from '../filters/attribute-match.ts';
import type { FilterContext, FilterTest } from '../programs/kept-contexts.ts';
import type { ProgramFailure, ProgramRun } from '../programs/program-run.ts';

export interface PreparedFilter {
  readonly attributes: readonly FilterAttribute<FilterTest>[];
}

export type Stopped = Extract<ProgramFailure, { readonly ran: 'exhausted' }>;

export type Matching = { readonly matched: boolean; readonly work: number } | { readonly stopped: Stopped };

export type RunTest = (test: FilterTest, actual: Json) => ProgramRun;

export function preparedFilters(
  filters: readonly JsonObject[],
  define: FilterContext['define'],
): readonly PreparedFilter[] {
  return filters
    .filter((filter) => typeof field(filter, 'type') === 'string')
    .map((filter) => ({ attributes: filterAttributesOf(filter, define) }));
}

function filterMatching({ attributes }: PreparedFilter, event: JsonObject, runTest: RunTest): Matching {
  const tested: { work: number; stopped?: Stopped } = { work: 0 };
  const matched = attributes.every((attribute) =>
    attributeHolds(attribute, event, (test, actual) => {
      const run = runTest(test, actual);
      if (run.ran === 'exhausted') {
        tested.stopped = run;
        return false;
      }
      tested.work += run.work;
      return run.ran === 'answered' ? jsonOfText(run.text) : null;
    }),
  );
  return tested.stopped === undefined ? { matched, work: tested.work } : { stopped: tested.stopped };
}

export function matchingOf(filters: readonly PreparedFilter[], event: JsonObject, runTest: RunTest): Matching {
  let work = 0;
  for (const filter of filters) {
    const matching = filterMatching(filter, event, runTest);
    if (!('matched' in matching) || matching.matched) {
      return 'matched' in matching ? { matched: true, work: work + matching.work } : matching;
    }
    work += matching.work;
  }
  return { matched: false, work };
}
