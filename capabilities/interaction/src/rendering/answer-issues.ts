import { Schema } from 'effect';

import { answerIssuesOf } from '../requests/answer-check.ts';
import { placesNeverSet, segmentsOf, subschemaAt } from './answer-places.ts';
import type { CardIssue } from './card-issues.ts';
import { expressionsIn } from './expressions.ts';
import { pointerTo } from './json-pointers.ts';
import { entriesOf, hasKey, isList, isRecord, itemsOf } from './written-values.ts';

interface WrittenSet {
  readonly pointer: string;
  readonly at: unknown;
  readonly value: unknown;
}

const noSuchPlaceWords = (place: string): string =>
  `The answer has no place ${place}: set a place the output schema names`;

const neverSetWords = (place: string): string =>
  `No button sets ${place}, which the answer needs, so the buttons of this card cannot answer it: add a button that sets it`;

function setsOfButton(id: string, element: unknown): readonly WrittenSet[] {
  const props = isRecord(element) && element['type'] === 'Button' ? element['props'] : undefined;
  const sets = isRecord(props) ? props['sets'] : undefined;
  if (!isList(sets)) {
    return [];
  }
  const base = pointerTo(pointerTo(pointerTo('/elements', id), 'props'), 'sets');
  return itemsOf(sets).flatMap(([index, set]) =>
    isRecord(set) && hasKey(set, 'value')
      ? [{ pointer: pointerTo(base, index), at: set['at'], value: set['value'] }]
      : [],
  );
}

function buttonSetsOf(card: unknown): readonly WrittenSet[] {
  const elements = isRecord(card) ? card['elements'] : undefined;
  return isRecord(elements) ? entriesOf(elements).flatMap(([id, element]) => setsOfButton(id, element)) : [];
}

const isJson = Schema.is(Schema.Json);

function isWrittenOut(value: unknown): value is Schema.Json {
  return isJson(value) && expressionsIn(value, '').length === 0;
}

function placeIssues({ pointer, at, value }: WrittenSet, schema: Schema.JsonObject): readonly CardIssue[] {
  if (typeof at !== 'string' || !at.startsWith('/')) {
    return [];
  }
  const found = subschemaAt(schema, segmentsOf(at));
  if (found.kind === 'none') {
    return [{ pointer: pointerTo(pointer, 'at'), detail: noSuchPlaceWords(at) }];
  }
  if (found.kind === 'open' || !isWrittenOut(value)) {
    return [];
  }
  return answerIssuesOf(value, found.schema).map(({ detail }) => ({
    pointer: pointerTo(pointer, 'value'),
    detail: `This does not fit ${at}: ${detail}`,
  }));
}

function neverSetIssues(sets: readonly WrittenSet[], schema: Schema.JsonObject): readonly CardIssue[] {
  const places = sets.map(({ at }) => at);
  const written = places.filter((at): at is string => typeof at === 'string' && at.startsWith('/'));
  const [first] = sets;
  if (first === undefined || written.length !== places.length) {
    return [];
  }
  return placesNeverSet(schema, written).map((place) => ({ pointer: first.pointer, detail: neverSetWords(place) }));
}

export function answerIssues(card: unknown, outputSchema?: Schema.JsonObject): readonly CardIssue[] {
  const sets = buttonSetsOf(card);
  if (outputSchema === undefined || sets.length === 0) {
    return [];
  }
  return [...sets.flatMap((set) => placeIssues(set, outputSchema)), ...neverSetIssues(sets, outputSchema)];
}
