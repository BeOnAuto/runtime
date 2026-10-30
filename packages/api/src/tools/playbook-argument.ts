import { PlaybookIdSchema, rejected, type Rejected } from '@on.auto/operations';
import { Option, Result, Schema, SchemaIssue } from 'effect';

import { inlinedRootOf, withoutUnreferencedDefinitions, type JsonSchema } from './tool-schema.ts';

export interface PlaybookArgument {
  readonly playbook: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const playbookProperty: JsonSchema = {
  ...Schema.toJsonSchemaDocument(PlaybookIdSchema).schema,
  description: 'The id of the playbook to act in',
};

const ObjectFieldsSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const UnionSchema = Schema.Struct({
  anyOf: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  $defs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
});

const objectFieldsOf = Schema.decodeUnknownSync(ObjectFieldsSchema);

const unionOf = Schema.decodeUnknownOption(UnionSchema);

const decodePlaybookArgument = Schema.decodeUnknownResult(Schema.Struct({ playbook: PlaybookIdSchema }));

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

function withPlaybookProperty(object: Readonly<JsonSchema>): JsonSchema {
  const { properties = {}, required = [] } = objectFieldsOf(object);
  return { ...object, properties: { playbook: playbookProperty, ...properties }, required: ['playbook', ...required] };
}

function withPlaybookOnEveryMember(schema: Readonly<JsonSchema>): JsonSchema {
  return Option.match(unionOf(schema), {
    onNone: () => withPlaybookProperty(schema),
    onSome: ({ anyOf, $defs = {} }) => ({
      ...schema,
      anyOf: anyOf.map((member) => withPlaybookProperty(inlinedRootOf({ schema: member, definitions: $defs }))),
    }),
  });
}

export function withPlaybookArgument(schema: Readonly<JsonSchema>): JsonSchema {
  return withoutUnreferencedDefinitions(withPlaybookOnEveryMember(schema));
}

export function withoutPlaybook(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(input).filter(([key]: readonly [string, unknown]) => key !== 'playbook'));
}

export function playbookArgumentOf(
  input: Readonly<Record<string, unknown>>,
): Result.Result<PlaybookArgument, Rejected> {
  const decoded = decodePlaybookArgument(input);
  if (Result.isSuccess(decoded)) {
    return Result.succeed({ playbook: decoded.success.playbook, input: withoutPlaybook(input) });
  }
  const issues = failureOf(decoded.failure.issue).issues.map(({ message }) => ({
    detail: message,
    pointer: '/playbook',
  }));
  return Result.fail(rejected('invalid_input', 'The input does not match the input schema', issues));
}
