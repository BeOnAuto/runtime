import {
  compileJsonSchema,
  issuesDetail,
  jsonSchemaLimits,
  type SchemaIssue,
  type Validation,
} from '@on.auto/json-schema';
import { Result, Schema } from 'effect';

const ArgumentIssueSchema = Schema.Struct({
  path: Schema.String.annotate({
    description: 'The JSON Pointer of the argument at fault, empty for the arguments as a whole',
  }),
  message: Schema.String.annotate({ description: 'What is wrong there, in words' }),
});

export const ArgumentCheckSchema = Schema.Struct({
  valid: Schema.NullOr(Schema.Boolean).annotate({
    description:
      "true when the arguments match the tool's input schema, false when they do not, null when this server cannot check them against it",
  }),
  issues: Schema.Array(ArgumentIssueSchema).annotate({
    description:
      'Where the arguments do not match, at most 20 and then one saying how many more there are; one saying why when they could not be checked',
  }),
});

export type ArgumentCheck = typeof ArgumentCheckSchema.Type;

type ArgumentIssue = typeof ArgumentIssueSchema.Type;

const checking: Validation = { what: 'arguments object', nesting: jsonSchemaLimits.nesting, otherFormats: 'unchecked' };

function issueOf({ pointer, detail }: SchemaIssue): ArgumentIssue {
  return { path: pointer, message: detail };
}

export function uncheckable(why: string): ArgumentCheck {
  return { valid: null, issues: [{ path: '', message: why }] };
}

function schemaRefused(issues: readonly SchemaIssue[]): ArgumentCheck {
  return uncheckable(
    `This server cannot check arguments against the tool's input schema, at ${issuesDetail(issues.slice(0, 1), 'input schema')}`,
  );
}

export function checkedArguments(inputSchema: Schema.JsonObject, input: Schema.JsonObject): ArgumentCheck {
  return Result.match(compileJsonSchema(inputSchema, checking), {
    onFailure: schemaRefused,
    onSuccess: ({ validate }) =>
      Result.match(validate(input), {
        onFailure: (issues) => ({ valid: false, issues: issues.map((issue) => issueOf(issue)) }),
        onSuccess: () => ({ valid: true, issues: [] }),
      }),
  });
}
