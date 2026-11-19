import { Array as Arr, Cause, Effect, Option, Schema } from 'effect';

import { pointerOf } from '../outcome/pointer.ts';

export type Place = readonly (string | number)[];

interface TextGiven {
  readonly place: Place;
  readonly text: string;
}

interface ValueRead {
  readonly place: Place;
  readonly value: Schema.Json;
}

interface GivenValue<Value, Taken, Refusal> {
  readonly value: Value;
  readonly check: (value: Value) => Effect.Effect<Taken, Refusal>;
  readonly textsIn: (refusal: Refusal) => readonly TextGiven[];
  readonly withValuesRead: (read: Arr.NonEmptyReadonlyArray<ValueRead>) => Value;
  readonly takes: (read: Schema.Json) => boolean;
}

interface Normalized<Value, Taken> {
  readonly value: Value;
  readonly taken: Taken;
  readonly readFrom: readonly Place[];
}

export interface GivenArgument {
  readonly operation: string;
  readonly argument: string;
}

const takenFromText = 'An argument given as JSON text was taken as the value the text holds';

const jsonHeldIn = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

export function overflowedTheStack<E>(cause: Cause.Cause<E>): boolean {
  return Cause.squash(cause) instanceof RangeError;
}

function isNotText(value: Schema.Json): boolean {
  return typeof value !== 'string';
}

function valueRead(
  { place, text }: TextGiven,
  takes: (read: Schema.Json) => boolean,
): Effect.Effect<Option.Option<ValueRead>> {
  return Effect.option(jsonHeldIn(text)).pipe(
    Effect.map(Option.filter((read) => isNotText(read) && takes(read))),
    Effect.map(Option.map((value) => ({ place, value }))),
  );
}

function takenFromTexts<Value, Taken, Refusal>(
  { check, textsIn, withValuesRead, takes }: GivenValue<Value, Taken, Refusal>,
  refusal: Refusal,
): Effect.Effect<Option.Option<Normalized<Value, Taken>>> {
  const taking = Effect.gen(function* () {
    const read = Arr.getSomes(yield* Effect.forEach(textsIn(refusal), (text) => valueRead(text, takes)));
    if (!Arr.isReadonlyArrayNonEmpty(read)) {
      return Option.none<Normalized<Value, Taken>>();
    }
    const value = withValuesRead(read);
    const readFrom = read.map(({ place }) => place);
    return yield* Effect.option(Effect.map(check(value), (taken) => ({ value, taken, readFrom })));
  });
  return Effect.catchCauseIf(taking, overflowedTheStack, () => Effect.succeedNone);
}

export function normalizedValue<Value, Taken, Refusal>(
  given: GivenValue<Value, Taken, Refusal>,
): Effect.Effect<Normalized<Value, Taken>, Refusal> {
  return Effect.matchEffect(
    Effect.suspend(() => given.check(given.value)),
    {
      onSuccess: (taken) => Effect.succeed({ value: given.value, taken, readFrom: [] }),
      onFailure: (refusal) =>
        Effect.flatMap(
          takenFromTexts(given, refusal),
          Option.match({
            onNone: () => Effect.fail(refusal),
            onSome: (normalized) => Effect.succeed(normalized),
          }),
        ),
    },
  );
}

const mostArgumentsLogged = 10;

export function loggedAsTakenFromText(operation: string, taken: readonly string[]): Effect.Effect<void> {
  const listed = taken.slice(0, mostArgumentsLogged);
  const unlisted = taken.length - listed.length;
  return Effect.logInfo(takenFromText).pipe(
    Effect.annotateLogs({
      operation,
      argument: listed.join(', '),
      ...(unlisted === 0 ? {} : { more_arguments: unlisted }),
    }),
  );
}

const objectOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

function childOf(value: unknown, key: string | number): unknown {
  return Arr.isArray(value) ? value[Number(key)] : objectOf(value)[key];
}

function valueAt(value: unknown, place: Place): unknown {
  return place.reduce<unknown>((within, key) => childOf(within, key), value);
}

export function textsAt(value: unknown, places: readonly Place[]): readonly TextGiven[] {
  const distinct = new Map(places.map((place) => [pointerOf(place), place]));
  return [...distinct.values()].flatMap((place) => {
    const found = valueAt(value, place);
    return typeof found === 'string' ? [{ place, text: found }] : [];
  });
}

function placedAt(value: unknown, [key, ...rest]: Place, read: Schema.Json): unknown {
  if (key === undefined) {
    return read;
  }
  if (Arr.isArray(value)) {
    return value.map((item, index) => (index === key ? placedAt(item, rest, read) : item));
  }
  const object = objectOf(value);
  return { ...object, [key]: placedAt(object[key], rest, read) };
}

export function valuesPlacedIn(value: unknown, read: readonly ValueRead[]): unknown {
  return read.reduce((within, { place, value: held }) => placedAt(within, place, held), value);
}
