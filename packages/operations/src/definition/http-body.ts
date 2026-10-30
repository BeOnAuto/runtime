import { Effect } from 'effect';

import type { StreamedContent } from '../content/streamed-content.ts';
import { streamed, succeeded, type Succeeded } from '../outcome/outcome.ts';
import { outputEncoder } from './codecs.ts';
import { requireClosedOutput } from './definition-checks.ts';
import type {
  AnswerDeclarations,
  AnswerKind,
  AnswerValues,
  BodyArguments,
  HttpBody,
  ObjectSchema,
  StreamedBody,
  StreamedBodyKind,
} from './definition.ts';

type BodyArgumentsOf = {
  readonly [Kind in keyof BodyArguments]: (
    name: string,
    given: StreamedContent | undefined,
  ) => Effect.Effect<BodyArguments[Kind]>;
};

export const mediaTypeOfBody: Readonly<Record<StreamedBodyKind, string>> = {
  'octet-stream': 'application/octet-stream',
  csv: 'text/csv',
};

export function isStreamedBody(body: HttpBody): body is StreamedBody {
  return body.kind === 'octet-stream' || body.kind === 'csv';
}

export function requireMostBytes(name: string, body: HttpBody): void {
  if (isStreamedBody(body) && !(Number.isSafeInteger(body.mostBytes) && body.mostBytes > 0)) {
    throw new Error(`The most bytes of the body of ${name} must be a whole number above 0`);
  }
}

function noBody(): Effect.Effect<readonly []> {
  return Effect.succeed([]);
}

function streamedBody(name: string, given: StreamedContent | undefined): Effect.Effect<readonly [StreamedContent]> {
  return given === undefined
    ? Effect.die(new Error(`The operation ${name} takes its body as a stream and was given none`))
    : Effect.succeed([given]);
}

const bodyArgumentsOf: BodyArgumentsOf = {
  json: noBody,
  none: noBody,
  'octet-stream': streamedBody,
  csv: streamedBody,
};

export function bodyArgumentsFor<Kind extends keyof BodyArguments>(
  kind: Kind,
  name: string,
  given: StreamedContent | undefined,
): Effect.Effect<BodyArguments[Kind]> {
  return bodyArgumentsOf[kind](name, given);
}

type Answering<Out extends ObjectSchema> = {
  readonly [Kind in AnswerKind]: (
    declared: AnswerDeclarations<Out>[Kind],
  ) => (value: AnswerValues<Out>[Kind]) => Effect.Effect<Succeeded>;
};

export function answeringOf<Out extends ObjectSchema>(name: string): Answering<Out> {
  return {
    json: ({ outputSchema }) => {
      requireClosedOutput(name, outputSchema);
      const encode = outputEncoder(outputSchema);
      return (output) => Effect.map(encode(output), succeeded);
    },
    stream:
      ({ mediaType }) =>
      ({ stream, bytes }) =>
        Effect.succeed(streamed({ stream, bytes, mediaType })),
  };
}
