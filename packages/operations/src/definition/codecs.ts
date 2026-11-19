import { Effect, Exit, Option, Schema, SchemaIssue, type SchemaAST, type StandardSchema } from 'effect';

import {
  loggedAsTakenFromText,
  normalizedValue,
  overflowedTheStack,
  textsAt,
  valuesPlacedIn,
  type Place,
} from '../given-values/normalized-values.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import { pointerOf } from '../outcome/pointer.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { LinkToOpen, PlainLanguage, RegisteredPlainLanguage } from '../plain-language/plain-language.ts';
import type { AnswerAfterTheLink, ObjectSchema } from './definition.ts';
import type { InputEncoding } from './registered-run.ts';
import type { RegisteredLink } from './registration.ts';

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const strictly: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all' };

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

const asJsonObject = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json));

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function isPlaceKey(segment: IssueSegment): segment is string | number {
  return typeof segment === 'string' || typeof segment === 'number';
}

const declaresASizeBound = 'declaresASizeBound';

export function sizeBoundCheck<T>(within: (value: T) => true | string): SchemaAST.Filter<T> {
  return Schema.makeFilter(within, { [declaresASizeBound]: true });
}

function isPastASizeBound(issue: SchemaIssue.Issue): boolean {
  if (issue instanceof SchemaIssue.Filter) {
    return issue.filter.annotations?.[declaresASizeBound] === true;
  }
  if (issue instanceof SchemaIssue.Pointer) {
    return isPastASizeBound(issue.issue);
  }
  return issue instanceof SchemaIssue.Composite && issue.issues.every((each) => isPastASizeBound(each));
}

function invalidInput(issue: SchemaIssue.Issue): Rejected {
  const { issues }: StandardSchema.StandardSchemaV1.FailureResult = failureOf(issue);
  return rejected(
    'invalid_input',
    isPastASizeBound(issue) ? 'What was given is too large' : 'The input does not match the input schema',
    issues.map(({ message, path = [] }) => ({
      detail: message,
      pointer: pointerOf(path.filter((segment) => isPropertyKey(segment))),
    })),
  );
}

function nestedTooDeeply(): Rejected {
  return rejected('invalid_input', 'The input is nested too deeply', [
    { detail: 'The input is nested too deeply', pointer: '' },
  ]);
}

type Decoding<A> = (input: unknown) => Effect.Effect<A, SchemaIssue.Issue>;

function decodingBy<A>(
  decode: (input: unknown) => Effect.Effect<A, { readonly issue: SchemaIssue.Issue }>,
): Decoding<A> {
  return (input) => Effect.mapError(decode(input), ({ issue }) => issue);
}

function placeOf(path: readonly IssueSegment[]): Place {
  return path.filter((segment) => isPlaceKey(segment));
}

interface Refusal {
  readonly place: Place;
  readonly by: 'type' | 'check' | 'other';
}

function refusedBy(issue: SchemaIssue.Issue): Refusal['by'] {
  if (issue instanceof SchemaIssue.Filter) {
    return 'check';
  }
  return issue instanceof SchemaIssue.InvalidType || issue instanceof SchemaIssue.AnyOf ? 'type' : 'other';
}

function refusalsOf(issue: SchemaIssue.Issue, place: Place): readonly Refusal[] {
  if (issue instanceof SchemaIssue.Pointer) {
    return refusalsOf(issue.issue, [...place, ...placeOf(issue.path)]);
  }
  if (issue instanceof SchemaIssue.Encoding) {
    return refusalsOf(issue.issue, place);
  }
  if (issue instanceof SchemaIssue.Composite || (issue instanceof SchemaIssue.AnyOf && issue.issues.length > 0)) {
    return issue.issues.flatMap((each) => refusalsOf(each, place));
  }
  return [{ place, by: refusedBy(issue) }];
}

function placesToRead(issue: SchemaIssue.Issue): readonly Place[] {
  const refusals = refusalsOf(issue, []);
  const checked = new Set(refusals.filter(({ by }) => by === 'check').map(({ place }) => pointerOf(place)));
  return refusals.filter(({ place, by }) => by === 'type' && !checked.has(pointerOf(place))).map(({ place }) => place);
}

function isAnObjectOrAnArray(read: Schema.Json): boolean {
  return typeof read === 'object' && read !== null;
}

function jsonInputTaking<In extends ObjectSchema>(schema: In) {
  const decode = decodingBy(Schema.decodeUnknownEffect(Schema.toCodecJson(schema), strictly));
  return (input: unknown) =>
    normalizedValue({
      value: input,
      check: decode,
      textsIn: (issue: SchemaIssue.Issue) => textsAt(input, placesToRead(issue)),
      withValuesRead: (read) => valuesPlacedIn(input, read),
      takes: isAnObjectOrAnArray,
    });
}

export function inputDecoder<In extends ObjectSchema>(
  operation: string,
  schema: In,
): (input: unknown, encoding: InputEncoding) => Effect.Effect<In['Type'], Rejected> {
  const takeJson = jsonInputTaking(schema);
  const decoders: Readonly<Record<InputEncoding, Decoding<In['Type']>>> = {
    json: (input) =>
      takeJson(input).pipe(
        Effect.tap(({ readFrom }) =>
          readFrom.length === 0
            ? Effect.void
            : loggedAsTakenFromText(
                operation,
                readFrom.map((place) => pointerOf(place)),
              ),
        ),
        Effect.map(({ taken }) => taken),
      ),
    strings: decodingBy(Schema.decodeUnknownEffect(Schema.toCodecStringTree(schema), strictly)),
  };
  return (input, encoding) =>
    Effect.catchCauseIf(Effect.mapError(decoders[encoding](input), invalidInput), overflowedTheStack, () =>
      Effect.fail(nestedTooDeeply()),
    );
}

export function outputEncoder<Out extends ObjectSchema>(
  schema: Out,
): (output: Out['Type']) => Effect.Effect<Schema.JsonObject> {
  const encode = Schema.encodeUnknownEffect(Schema.toCodecJson(schema), strictly);
  return (output) => encode(output).pipe(Effect.flatMap(asJsonObject), Effect.orDie);
}

function registeredPlainLanguage<In extends ObjectSchema, Out extends ObjectSchema>(
  {
    task,
    attempt,
    attemptAsOffered,
    outcome,
    relayed,
    remedies = {},
    explanations = {},
  }: PlainLanguage<In['Type'], Out['Type']>,
  inputSchema: In,
  outputSchema: Out,
): RegisteredPlainLanguage {
  const takeJson = jsonInputTaking(inputSchema);
  const inputAsTaken = (input: unknown): unknown =>
    Exit.match(Effect.runSyncExit(takeJson(input)), { onFailure: () => input, onSuccess: ({ value }) => value });
  const decodeOfferedInput = Schema.decodeUnknownOption(Schema.toCodecJson(inputSchema));
  const decodeAcceptedInput = Schema.decodeUnknownSync(Schema.toCodecJson(inputSchema));
  const offeredInput = (input: unknown) =>
    Option.orElse(decodeOfferedInput(input), () => decodeOfferedInput(inputAsTaken(input)));
  const decodeOutput = Schema.decodeUnknownSync(Schema.toCodecJson(outputSchema));
  return {
    attempt: (input) =>
      Option.match(offeredInput(input), { onNone: () => attemptAsOffered?.(input) ?? task, onSome: attempt }),
    outcome: (output, input) =>
      outcome(
        decodeOutput(output),
        Option.getOrElse(offeredInput(input), () => decodeAcceptedInput(input)),
      ),
    ...(relayed === undefined ? {} : { relayed: (output: unknown) => relayed(decodeOutput(output)) }),
    remedies,
    explanations,
  };
}

export function plainLanguageFields<In extends ObjectSchema, Out extends ObjectSchema>(
  language: PlainLanguage<In['Type'], Out['Type']> | undefined,
  inputSchema: In,
  outputSchema: Out,
): { readonly plainLanguage?: RegisteredPlainLanguage } {
  return language === undefined ? {} : { plainLanguage: registeredPlainLanguage(language, inputSchema, outputSchema) };
}

interface Linking<Out, R extends DeclarableReason, Services> {
  readonly name: string;
  readonly linkToOpen?: ((output: Out) => LinkToOpen | undefined) | undefined;
  readonly answerAfterTheLink?: AnswerAfterTheLink<Out, R, Services> | undefined;
}

export function linkFields<Out extends ObjectSchema, R extends DeclarableReason, Services, Answering>(
  { name, linkToOpen, answerAfterTheLink }: Linking<Out['Type'], R, Services>,
  outputSchema: Out,
  answeringBy: (read: () => Effect.Effect<Out['Type'], Rejection<R>, Services>) => Answering,
): { readonly link?: RegisteredLink<Answering> } {
  if (linkToOpen === undefined && answerAfterTheLink === undefined) {
    return {};
  }
  if (linkToOpen === undefined || answerAfterTheLink === undefined) {
    throw new Error(`The operation ${name} gives one of linkToOpen and answerAfterTheLink without the other`);
  }
  const decodeOutput = Schema.decodeUnknownSync(Schema.toCodecJson(outputSchema));
  return {
    link: {
      toOpen: (output) => linkToOpen(decodeOutput(output)),
      idOf: (output) => answerAfterTheLink.idOf(decodeOutput(output)),
      answerAfter: (offered) => answeringBy(() => answerAfterTheLink.read(offered)),
      linkLastsMs: answerAfterTheLink.linkLastsMs,
    },
  };
}

export function typeValidator<S extends ObjectSchema>(schema: S): (value: S['Type']) => Effect.Effect<S['Type']> {
  const validate = Schema.decodeUnknownEffect(Schema.toType(schema), strictly);
  return (value) => Effect.orDie(validate(value));
}
