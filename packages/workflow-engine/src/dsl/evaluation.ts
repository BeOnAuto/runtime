import { mostExpressionWork, mostValueWork, mostWorkPerInput } from '../machine/limits.ts';
import type { ExpressionUnit } from '../programs/expression-units.ts';
import type { ProgramRun } from '../programs/program-run.ts';
import { readDuration } from './durations.ts';
import {
  enclosedBody,
  evaluationOf,
  expressionSource,
  runExpression,
  type Bound,
  type Evaluation,
} from './expressions.ts';
import {
  entriesOf,
  isList,
  isObject,
  isTruthy,
  measureOf,
  mostValueDepth,
  type Json,
  type JsonEntry,
  type JsonObject,
} from './json.ts';
import { RaisedError, errorType, raised } from './raised-error.ts';

interface ExpressionMeter {
  readonly allowance: () => number;
  readonly record: (work: number) => void;
}

export type Variables = Readonly<Record<string, Json>>;

export interface Place {
  readonly reference: string;
  readonly now: number;
  readonly meter: ExpressionMeter;
  readonly mostDuration: number;
  readonly unit: ExpressionUnit;
  readonly deadlineAt: number;
}

export const mostInputMs = 2000;

export const mostFilterMs = 200;

export function evaluate(source: string, data: Json, variables: Variables, place: Place): Json {
  const mostWork = place.meter.allowance();
  return answeredOrRaised(
    runExpression(
      place.unit,
      source,
      { ...variables, data },
      { now: place.now, mostWork, deadlineAt: place.deadlineAt },
    ),
    place,
    (limit) => inputBoundOf(limit, mostWork),
  );
}

export function testedOrRaised(source: string, run: ProgramRun, place: Pick<Place, 'reference' | 'meter'>): Json {
  return answeredOrRaised(evaluationOf(source, run), place, (limit) => filterBoundOf[limit]);
}

function answeredOrRaised(
  evaluation: Evaluation,
  place: Pick<Place, 'reference' | 'meter'>,
  boundFor: (limit: Bound) => string,
): Json {
  place.meter.record(evaluation.work);
  if ('value' in evaluation) {
    return evaluation.value;
  }
  if (evaluation.exhausted) {
    throw raised('runtime', 500, `${evaluation.problem}: ${boundFor(evaluation.limit)}`, place.reference);
  }
  throw new RaisedError({
    type: errorType('expression'),
    status: 400,
    title: 'An expression failed',
    detail: evaluation.problem,
    instance: place.reference,
  });
}

const inputBounds: Readonly<Record<Bound, string>> = {
  work: `an expression may do ${mostExpressionWork} checkpoints of work`,
  memory: 'the expressions of one input may use the memory of their sandbox and no more',
  deadline: `the expressions of one input may take ${mostInputMs} ms`,
};

const filterBoundOf: Readonly<Record<Bound, string>> = {
  work: `an expression of a filter may do ${mostExpressionWork} checkpoints of work, and those of one filter ${mostWorkPerInput} together`,
  memory: 'one filter may use the memory of its sandbox and no more',
  deadline: `one filter may take ${mostFilterMs} ms`,
};

function inputBoundOf(limit: Bound, mostWork: number): string {
  return limit === 'work' && mostWork < mostExpressionWork
    ? `the workflow did ${mostWorkPerInput} checkpoints of expression work in one input; it lets other workflows run between tasks, not within one`
    : inputBounds[limit];
}

export function evaluateExpression(expression: string, data: Json, variables: Variables, place: Place): Json {
  return evaluate(expressionSource(expression), data, variables, place);
}

export function holds(condition: Json | undefined, data: Json, variables: Variables, place: Place): boolean {
  return typeof condition !== 'string' || isTruthy(evaluateExpression(condition, data, variables, place));
}

export function evaluateTemplate(template: Json, data: Json, variables: Variables, place: Place): Json {
  const body = enclosedBody(template);
  if (body !== undefined) {
    return evaluate(body, data, variables, place);
  }
  if (isList(template)) {
    return template.map((item) => evaluateTemplate(item, data, variables, place));
  }
  return isObject(template) ? evaluateObject(template, data, variables, place) : template;
}

export function transform(transformation: Json | undefined, data: Json, variables: Variables, place: Place): Json {
  if (transformation === undefined) {
    return data;
  }
  return typeof transformation === 'string'
    ? evaluateExpression(transformation, data, variables, place)
    : evaluateTemplate(transformation, data, variables, place);
}

export function millisecondsOf(duration: Json, data: Json, variables: Variables, place: Place): number {
  const reading = readDuration(evaluateTemplate(duration, data, variables, place));
  if ('problem' in reading) {
    throw raised('configuration', 400, `A duration of the task is not valid: ${reading.problem}`, place.reference);
  }
  if (reading.milliseconds > place.mostDuration) {
    throw raised(
      'configuration',
      400,
      `A duration of the task, ${reading.milliseconds} ms, is longer than the ${place.mostDuration} ms a workflow may run`,
      place.reference,
    );
  }
  return reading.milliseconds;
}

function evaluateObject(template: JsonObject, data: Json, variables: Variables, place: Place): JsonObject {
  return Object.fromEntries(
    entriesOf(template).map(([key, value]: JsonEntry) => [key, evaluateTemplate(value, data, variables, place)]),
  );
}

export function admitted(value: Json, reference: string): Json {
  const measure = measureOf(value);
  if (measure === undefined) {
    throw raised('runtime', 500, `A value nests more than ${mostValueDepth} levels deep`, reference);
  }
  if (measure.work > mostValueWork) {
    throw raised(
      'runtime',
      500,
      `A value takes ${measure.work} units of work to visit, more than the ${mostValueWork} a workflow may hold`,
      reference,
    );
  }
  return value;
}
