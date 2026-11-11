import { Option, Schema } from 'effect';

export const ShapeSchema = Schema.Literals(['J', 'C', 'R', 'A', 'P', 'M']);

export type Shape = typeof ShapeSchema.Type;

type Outcome = 'right' | 'under-split' | 'over-split';

const PlannedDefinitionSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  tools: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  calls: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
});

export type PlannedDefinition = typeof PlannedDefinitionSchema.Type;

const PlanSchema = Schema.Struct({ definitions: Schema.Array(PlannedDefinitionSchema) });

const LoadSchema = Schema.Struct({ load: Schema.Array(Schema.String) });

const decodedPlan = Schema.decodeUnknownOption(Schema.fromJsonString(PlanSchema));

const decodedLoad = Schema.decodeUnknownOption(Schema.fromJsonString(LoadSchema));

function placesOf(answer: string, pattern: Readonly<RegExp>): readonly number[] {
  const places: number[] = [];
  for (const { index } of answer.matchAll(pattern)) {
    places.push(index);
  }
  return places;
}

function lastDecoded<T>(
  answer: string,
  opening: Readonly<RegExp>,
  decoded: (text: string) => Option.Option<T>,
): T | undefined {
  const ends = placesOf(answer, /\}/gu)
    .map((place) => place + 1)
    .toReversed();
  for (const start of placesOf(answer, opening).toReversed()) {
    for (const end of ends.filter((place) => place > start)) {
      const found = decoded(answer.slice(start, end));
      if (Option.isSome(found)) {
        return found.value;
      }
    }
  }
  return undefined;
}

export function planIn(answer: string): readonly PlannedDefinition[] | undefined {
  return lastDecoded(answer, /\{\s*"definitions"\s*:/gu, decodedPlan)?.definitions;
}

export function toolsAskedIn(answer: string): readonly string[] {
  return lastDecoded(answer, /\{\s*"load"\s*:/gu, decodedLoad)?.load ?? [];
}

interface Counted {
  readonly count: (type: string) => number;
  readonly functions: readonly string[];
  readonly beyond: (allowed: readonly string[]) => readonly string[];
  readonly reasoningNamesTools: boolean;
  readonly mostCalls: number;
}

function countedIn(definitions: readonly PlannedDefinition[]): Counted {
  const types = definitions.map(({ type }) => type ?? '');
  const functions = types.filter((type) => type !== 'workflow');
  const ofType = (type: string) => definitions.filter((definition) => definition.type === type);
  return {
    count: (type) => types.filter((each) => each === type).length,
    functions,
    beyond: (allowed) => functions.filter((type) => !allowed.includes(type)),
    reasoningNamesTools: ofType('reasoning').some(({ tools }) => (tools ?? []).length > 0),
    mostCalls: Math.max(0, ...ofType('workflow').map(({ calls }) => (calls ?? []).length)),
  };
}

function rightOr(right: boolean): Outcome {
  return right ? 'right' : 'over-split';
}

function oneOf(type: string): (counted: Counted) => Outcome {
  return ({ count, functions }) =>
    count(type) === 0 ? 'under-split' : rightOr(functions.length === 1 && functions[0] === type);
}

function readCalculateWrite({ count, beyond, reasoningNamesTools, mostCalls }: Counted): Outcome {
  const parts = ['lookup', 'computation', 'reasoning'];
  if (parts.some((type) => count(type) === 0) || reasoningNamesTools || mostCalls < 3) {
    return 'under-split';
  }
  return rightOr(count('reasoning') === 1 && beyond(parts).length === 0);
}

function readJudgeAskAct({ count, beyond, mostCalls }: Counted): Outcome {
  if (count('lookup') === 0 || count('reasoning') === 0 || count('interaction') < 2 || mostCalls < 4) {
    return 'under-split';
  }
  return rightOr(count('reasoning') === 1 && beyond(['lookup', 'reasoning', 'interaction']).length === 0);
}

function forecastThenDecide({ count, beyond }: Counted): Outcome {
  if (count('prediction') === 0 || count('computation') + count('reasoning') === 0) {
    return 'under-split';
  }
  return rightOr(beyond(['prediction', 'computation', 'reasoning', 'lookup']).length === 0);
}

function theModelChooses({ count, beyond, reasoningNamesTools }: Counted): Outcome {
  if (beyond(['reasoning']).length > 0 || count('reasoning') > 1) {
    return 'over-split';
  }
  return reasoningNamesTools ? 'right' : 'under-split';
}

const outcomeByShape: Readonly<Record<Shape, (counted: Counted) => Outcome>> = {
  J: oneOf('reasoning'),
  C: oneOf('computation'),
  R: readCalculateWrite,
  A: readJudgeAskAct,
  P: forecastThenDecide,
  M: theModelChooses,
};

export function outcomeOf(shape: Shape, definitions: readonly PlannedDefinition[]): Outcome {
  return outcomeByShape[shape](countedIn(definitions));
}
