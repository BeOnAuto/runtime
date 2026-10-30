import type { DslError } from '../machine/dsl-error.ts';
import { evaluateTemplate, holds, millisecondsOf, type Place, type Variables } from './evaluation.ts';
import {
  entriesOf,
  field,
  isObject,
  listField,
  objectField,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from './json.ts';
import { RaisedError, errorAsJson, errorFromJson, raised } from './raised-error.ts';

export interface Site {
  readonly data: Json;
  readonly variables: Variables;
  readonly place: Place;
}

const filterFields: Readonly<Record<string, string>> = { details: 'detail' };

function casesOf(task: JsonObject): readonly JsonObject[] {
  return (listField(task, 'switch') ?? []).flatMap((item) =>
    isObject(item) ? entriesOf(item).flatMap(([, switchCase]) => (isObject(switchCase) ? [switchCase] : [])) : [],
  );
}

export function chosenFlow(task: JsonObject, { data, variables, place }: Site): string | undefined {
  const cases = casesOf(task);
  const matched = cases.find((switchCase) => {
    const when = field(switchCase, 'when');
    return when !== undefined && holds(when, data, variables, place);
  });
  const chosen = matched ?? cases.find((switchCase) => field(switchCase, 'when') === undefined);
  return chosen === undefined ? undefined : textField(chosen, 'then');
}

export function raisedBy(task: JsonObject, errors: JsonObject, { data, variables, place }: Site): RaisedError {
  const declared = field(objectField(task, 'raise') ?? {}, 'error');
  const definition = typeof declared === 'string' ? field(errors, declared) : declared;
  const evaluated = definition === undefined ? null : evaluateTemplate(definition, data, variables, place);
  const error = isObject(evaluated) ? errorFromJson(evaluated, place.reference) : undefined;
  return error === undefined
    ? raised('configuration', 400, 'raise names no error with a type and a status', place.reference)
    : new RaisedError(error);
}

export function catches(handler: JsonObject, error: DslError, { data, variables, place }: Site): boolean {
  const filter = objectField(objectField(handler, 'errors') ?? {}, 'with') ?? {};
  const raisedJson = errorAsJson(error);
  const exceptWhen = field(handler, 'exceptWhen');
  return (
    entriesOf(filter).every(([key, expected]: JsonEntry) => field(raisedJson, filterFields[key] ?? key) === expected) &&
    holds(field(handler, 'when'), data, variables, place) &&
    (exceptWhen === undefined || !holds(exceptWhen, data, variables, place))
  );
}

function timeoutDefinition(
  declared: Json | undefined,
  timeouts: JsonObject,
  reference: string,
): JsonObject | undefined {
  if (typeof declared !== 'string') {
    return isObject(declared) ? declared : undefined;
  }
  const reused = objectField(timeouts, declared);
  if (reused === undefined) {
    throw raised('configuration', 400, `use.timeouts has no timeout ${declared}`, reference);
  }
  return reused;
}

export function timeoutMilliseconds(declared: Json | undefined, timeouts: JsonObject, site: Site): number | undefined {
  const timeout = timeoutDefinition(declared, timeouts, site.place.reference);
  return timeout === undefined
    ? undefined
    : millisecondsOf(field(timeout, 'after') ?? null, site.data, site.variables, site.place);
}

export function timedOut(milliseconds: number, reference: string): RaisedError {
  return raised('timeout', 408, `The task did not finish within ${milliseconds} ms`, reference);
}
