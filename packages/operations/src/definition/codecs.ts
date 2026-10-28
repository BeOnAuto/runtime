import { Cause, Effect, Option, Result, Schema, SchemaIssue, type SchemaAST, type StandardSchema } from 'effect';

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

function invalidInput({ issues }: StandardSchema.StandardSchemaV1.FailureResult): Rejected {
  return rejected(
    'invalid_input',
    'The input does not match the input schema',
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

function overflowedTheStack<E>(cause: Cause.Cause<E>): boolean {
  return Cause.squash(cause) instanceof RangeError;
}

export function inputDecoder<In extends ObjectSchema>(
  schema: In,
): (input: unknown, encoding: InputEncoding) => Effect.Effect<In['Type'], Rejected> {
  const decoders = {
    json: Schema.decodeUnknownEffect(Schema.toCodecJson(schema), strictly),
    strings: Schema.decodeUnknownEffect(Schema.toCodecStringTree(schema), strictly),
  };
  const decode = Effect.fnUntraced(function* (input: unknown, encoding: InputEncoding) {
    const decoded = yield* Effect.result(decoders[encoding](input));
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(invalidInput(failureOf(decoded.failure.issue)));
    }
    return decoded.success;
  });
  return (input, encoding) =>
    Effect.catchCauseIf(decode(input, encoding), overflowedTheStack, () => Effect.fail(nestedTooDeeply()));
}

export function outputEncoder<Out extends ObjectSchema>(
  schema: Out,
): (output: Out['Type']) => Effect.Effect<Schema.JsonObject> {
  const encode = Schema.encodeUnknownEffect(Schema.toCodecJson(schema), strictly);
  return (output) => encode(output).pipe(Effect.flatMap(asJsonObject), Effect.orDie);
}

function registeredPlainLanguage<In extends ObjectSchema, Out extends ObjectSchema>(
  { task, attempt, outcome, remedies = {} }: PlainLanguage<In['Type'], Out['Type']>,
  inputSchema: In,
  outputSchema: Out,
): RegisteredPlainLanguage {
  const decodeOfferedInput = Schema.decodeUnknownOption(Schema.toCodecJson(inputSchema));
  const decodeAcceptedInput = Schema.decodeUnknownSync(Schema.toCodecJson(inputSchema));
  const decodeOutput = Schema.decodeUnknownSync(Schema.toCodecJson(outputSchema));
  return {
    attempt: (input) => Option.match(decodeOfferedInput(input), { onNone: () => task, onSome: attempt }),
    outcome: (output, input) => outcome(decodeOutput(output), decodeAcceptedInput(input)),
    remedies,
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
