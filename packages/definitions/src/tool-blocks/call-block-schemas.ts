import { Schema } from 'effect';

const ArgumentsSchema = Schema.Record(Schema.String, Schema.Json).annotate({
  description:
    "The arguments of the call, named as the tool's input_schema names them; a number, boolean, null, list or object is sent as written, with the Liquid templates in its strings rendered; a string that is one {{ expression }} alone is sent as the value it reads; any other string is rendered as text",
});

export const ToolUseSchema = Schema.Struct({
  server: Schema.String.annotate({ description: 'The tool server, as search names it' }),
  tool: Schema.String.annotate({ description: 'The tool of that server, as search lists it' }),
  with: ArgumentsSchema,
});

export const CallBlockSchema = Schema.Struct({
  ...ToolUseSchema.fields,
  with: Schema.optionalKey(ArgumentsSchema),
  read: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "A JSON Pointer into the document of the tool's answer, to the value the function answers with; the whole document when left out",
    }),
  ),
});

export type CallBlock = typeof CallBlockSchema.Type;
