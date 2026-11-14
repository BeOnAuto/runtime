import { resolvedAt } from './json-pointer.ts';
import type {
  ConditionVerdict,
  Contribution,
  Extracted,
  Observation,
  ObservationSource,
  ObservedMeasurement,
  RefusedObservation,
} from './observation.ts';
import { isRefused, measurementAt, perIdAt, saysAt, textAt, type Read } from './observed-values.ts';

export const mostItems = 100;

const mostDetailBytes = 256;

const utf8 = new TextEncoder();

interface Item {
  readonly value: unknown;
  readonly index?: number;
}

type Items = { readonly items: readonly Item[]; readonly refused?: string } | { readonly refused: string };

type ItemOutcome = { readonly observation: Observation } | { readonly refused: string } | 'none';

const nothingObserved: Extracted = { observations: [], refused: [] };

function withinBytes(text: string): string {
  const characters = Array.from(text);
  return utf8.encode(text).length <= mostDetailBytes ? text : withinBytes(characters.slice(0, -1).join(''));
}

function placeOf(contribution: Contribution, item: number | undefined): string {
  const entry = `/contributes/${contribution.entryIndex}`;
  return item === undefined ? entry : `${entry}, item ${item}`;
}

function refusalOf(contribution: Contribution, item: number | undefined, detail: string): RefusedObservation {
  return {
    goal: contribution.goal.id,
    workflow: contribution.run.workflow,
    run: contribution.run.run,
    detail: withinBytes(`${placeOf(contribution, item)}: ${detail}`),
  };
}

function itemsOf({ entry, run }: Contribution): Items {
  if (entry.each === undefined) {
    return { items: [{ value: run.output }] };
  }
  const resolved = resolvedAt(run.output, entry.each);
  if (!resolved.found || resolved.value === null) {
    return { items: [] };
  }
  if (!Array.isArray(resolved.value)) {
    return { refused: `each at ${entry.each} is not a list` };
  }
  const list: readonly unknown[] = resolved.value;
  const items = list.slice(0, mostItems).map((value, index) => ({ value, index }));
  return list.length > mostItems
    ? {
        items,
        refused: `each at ${entry.each} has ${list.length} items; items ${mostItems} to ${list.length - 1} were left out`,
      }
    : { items };
}

function verdictOf(contribution: Contribution, index: number): ConditionVerdict | 'not_reached' {
  const { when } = contribution;
  if (contribution.entry.when === undefined) {
    return true;
  }
  return when === undefined || when === 'not_reached' ? 'not_reached' : (when[index] ?? 'not_reached');
}

function sourceOf(contribution: Contribution, item: Item): ObservationSource {
  const { run } = contribution;
  const source = { record: run.record, run: run.run, workflow: run.workflow, version: run.version };
  return item.index === undefined
    ? { ...source, entry: contribution.entryIndex }
    : { ...source, entry: contribution.entryIndex, item: item.index };
}

function perOf(contribution: Contribution, item: Item): Read<{ readonly per?: string }> | 'none' {
  const pointer = contribution.entry.per_id;
  if (contribution.goal.per === undefined) {
    return { value: {} };
  }
  const id = pointer === undefined ? 'none' : perIdAt(item.value, pointer);
  if (id === 'none' || isRefused(id)) {
    return id;
  }
  return { value: { per: id.value } };
}

interface ItemValues {
  readonly per: { readonly per?: string };
  readonly measurement: ObservedMeasurement | undefined;
  readonly says: string | undefined;
}

function observationWith(contribution: Contribution, item: Item, values: ItemValues): Observation {
  const { entry, run } = contribution;
  return {
    goal: contribution.goal.id,
    source: sourceOf(contribution, item),
    at: run.ended_at,
    ...values.per,
    ...(entry.marks === undefined ? {} : { marks: entry.marks }),
    ...(values.measurement === undefined ? {} : { measurement: values.measurement }),
    ...titled(textAt(entry.title, item.value), textAt(entry.link, item.value)),
    ...(values.says === undefined ? {} : { says: values.says }),
  };
}

function titled(
  title: string | undefined,
  link: string | undefined,
): { readonly title?: string; readonly link?: string } {
  return { ...(title === undefined ? {} : { title }), ...(link === undefined ? {} : { link }) };
}

function observationOf(contribution: Contribution, item: Item): ItemOutcome {
  const per = perOf(contribution, item);
  if (per === 'none' || isRefused(per)) {
    return per;
  }
  const measurement = measurementAt(contribution.entry, item.value, contribution.run.ended_at);
  if (isRefused(measurement)) {
    return measurement;
  }
  const says = saysAt(contribution.entry.says, item.value);
  if (isRefused(says)) {
    return says;
  }
  return {
    observation: observationWith(contribution, item, {
      per: per.value,
      measurement: measurement.value,
      says: says.value,
    }),
  };
}

function outcomeOf(contribution: Contribution, item: Item, index: number): ItemOutcome {
  const verdict = verdictOf(contribution, index);
  if (verdict === 'not_reached') {
    return { refused: 'the condition took too long' };
  }
  if (verdict === false || verdict === null) {
    return 'none';
  }
  return verdict === true
    ? observationOf(contribution, item)
    : { refused: `the condition cannot be evaluated: ${verdict.failed}` };
}

function idOf(contribution: Contribution, item: Item): string | undefined {
  const pointer = contribution.entry.per_id;
  const id = contribution.goal.per === undefined || pointer === undefined ? 'none' : perIdAt(item.value, pointer);
  return id === 'none' || isRefused(id) ? undefined : id.value;
}

function namedTwice(contribution: Contribution, items: readonly Item[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const item of items) {
    const id = idOf(contribution, item);
    if (id !== undefined) {
      (seen.has(id) ? twice : seen).add(id);
    }
  }
  return twice;
}

function withoutTwice(contribution: Contribution, each: string, items: readonly Item[]): Extracted {
  const twice = namedTwice(contribution, items);
  const once = items.filter((item) => {
    const id = idOf(contribution, item);
    return id === undefined || !twice.has(id);
  });
  const extracted = gathered(contribution, once, []);
  return {
    observations: extracted.observations,
    refused: [
      ...extracted.refused,
      ...[...twice].map((per) =>
        refusalOf(contribution, undefined, `the thing ${JSON.stringify(per)} is named twice in ${each}`),
      ),
    ],
  };
}

function gathered(contribution: Contribution, items: readonly Item[], whole: readonly RefusedObservation[]): Extracted {
  const outcomes: readonly { readonly item: Item; readonly outcome: ItemOutcome }[] = items.map((item) => ({
    item,
    outcome: outcomeOf(contribution, item, item.index ?? 0),
  }));
  return {
    observations: outcomes.flatMap(({ outcome }) =>
      outcome !== 'none' && 'observation' in outcome ? [outcome.observation] : [],
    ),
    refused: [
      ...whole,
      ...outcomes.flatMap(({ item, outcome }) =>
        outcome !== 'none' && 'refused' in outcome ? [refusalOf(contribution, item.index, outcome.refused)] : [],
      ),
    ],
  };
}

export function observationsOf(contribution: Contribution): Extracted {
  const items = itemsOf(contribution);
  if (!('items' in items)) {
    return { observations: [], refused: [refusalOf(contribution, undefined, items.refused)] };
  }
  if (items.items.length === 0) {
    return nothingObserved;
  }
  if (contribution.entry.when !== undefined && contribution.when === 'not_reached') {
    return { observations: [], refused: [refusalOf(contribution, undefined, 'the condition took too long')] };
  }
  const whole = items.refused === undefined ? [] : [refusalOf(contribution, undefined, items.refused)];
  if (contribution.entry.each === undefined) {
    return gathered(contribution, items.items, whole);
  }
  const extracted = withoutTwice(contribution, contribution.entry.each, items.items);
  return { observations: extracted.observations, refused: [...whole, ...extracted.refused] };
}

export function outputGoneRefusal(contribution: Omit<Contribution, 'when'>): RefusedObservation {
  return refusalOf(contribution, undefined, "the run's output can no longer be read");
}
