import { Schema } from 'effect';

const Templates = Schema.Record(Schema.String, Schema.Json);

export const SentSchema = Schema.Struct({
  conversation: Schema.String.annotate({
    description: 'A JSON Pointer into what the tool answered, to the conversation the message landed in',
  }),
  id: Schema.String.annotate({
    description: 'A JSON Pointer into what the tool answered, to the identity of the message',
  }),
});

const ArgumentsSchema = Templates.annotate({
  description:
    "The arguments of the call, named as the tool's input_schema names them; a number, boolean, null, list or object is sent as written, with the Liquid templates in its strings rendered; a string that is one {{ expression }} alone is sent as the value it reads; any other string is rendered as text",
});

const ToolUseSchema = Schema.Struct({
  server: Schema.String.annotate({ description: 'The tool server, as search names it' }),
  tool: Schema.String.annotate({ description: 'The tool of that server, as search lists it' }),
  with: ArgumentsSchema,
});

export const DeliverBlockSchema = Schema.Struct({
  ...ToolUseSchema.fields,
  sent: Schema.optionalKey(
    SentSchema.annotate({ description: 'Where, in what the tool answered, the message that was sent is named' }),
  ),
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

const ReadOrderSchema = Schema.Literals(['oldest_first', 'newest_first']);

export const EachSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'A JSON Pointer within each reply to its identity' }),
  sender: Schema.String.annotate({ description: 'A JSON Pointer within each reply to who wrote it' }),
  text: Schema.String.annotate({ description: 'A JSON Pointer within each reply to its words' }),
  to: Schema.optionalKey(
    Schema.String.annotate({ description: 'A JSON Pointer within each reply to the message it answers' }),
  ),
});

export const ReadSchema = Schema.Struct({
  list: Schema.String.annotate({ description: 'A JSON Pointer into what the reading tool answered, to its replies' }),
  order: ReadOrderSchema.annotate({ description: 'The order the tool lists replies in' }),
  each: EachSchema,
});

export const TellSchema = Schema.Struct({
  tool: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The tool that tells the party how to answer; the delivering tool when left out',
    }),
  ),
  with: Templates.annotate({
    description:
      'Its arguments over to, sent.conversation, sent.id and message, written as the arguments of deliver are',
  }),
});

export const RepliesSchema = Schema.Struct({
  conversation: Schema.optionalKey(
    Schema.String.annotate({
      description: 'A Liquid template over to, sent.conversation and sent.id rendering the key the playbook reads by',
    }),
  ),
  tool: Schema.String.annotate({ description: 'The tool of the delivering server that reads what came since a point' }),
  with: Templates.annotate({
    description:
      'The arguments of the read over to, sent.conversation, sent.id, conversation and since, written as the arguments of deliver are',
  }),
  read: ReadSchema,
  wait: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The shortest wait between two reads, from PT5S to PT1H; PT5S when left out',
    }),
  ),
  tell: Schema.optionalKey(TellSchema),
});

export const DeliveredAsSchema = Schema.Struct({ conversation: Schema.String, id: Schema.String });

export const RepliesInSchema = Schema.Struct({ server: Schema.String, tool: Schema.String, key: Schema.String });

export type DeliveredAs = typeof DeliveredAsSchema.Type;

export type RepliesIn = typeof RepliesInSchema.Type;

export type DeliverBlock = typeof DeliverBlockSchema.Type;

export type CallBlock = typeof CallBlockSchema.Type;

export type Replies = typeof RepliesSchema.Type;
