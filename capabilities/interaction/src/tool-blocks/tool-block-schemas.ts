import { ToolUseSchema } from '@on.auto/definitions/tool-blocks';
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

export const DeliverBlockSchema = Schema.Struct({
  ...ToolUseSchema.fields,
  sent: Schema.optionalKey(
    SentSchema.annotate({ description: 'Where, in what the tool answered, the message that was sent is named' }),
  ),
});

export const forAnAgent = 'agent';

export const DeliverSchema = Schema.Union([
  Schema.Literal(forAnAgent).annotate({
    description:
      'The request is for an agent, which reads it with list_interactions and answers it with answer_interaction',
  }),
  DeliverBlockSchema,
]).annotate({ expected: `${forAnAgent}, or the server, tool and with of the tool that sends the request` });

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

export const tellWords = ['all', 'refusals', 'none'] as const;

export type TellWord = (typeof tellWords)[number];

export const TellBlockSchema = Schema.Struct({
  when: Schema.optionalKey(
    Schema.Literals(['all', 'refusals']).annotate({
      description:
        "all to tell what became of every reply and how the request ended, refusals only when a reply was not taken; the provider's default when left out, else refusals",
    }),
  ),
  tool: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The tool that posts a line to the party; the delivering tool when left out',
    }),
  ),
  with: Templates.annotate({
    description:
      'Its arguments over to, sent.conversation, sent.id, message, reply.id and reply.to, written as the arguments of deliver are',
  }),
  sent: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A JSON Pointer into what the tool answered, to the identity of the message it posted; deliver.sent.id when the tool is the delivering tool',
    }),
  ),
});

const TellSchema = Schema.Union([
  Schema.Literals(tellWords).annotate({
    description:
      "all to tell the party what became of every reply and how the request ended, refusals only when a reply was not taken, none never, through the provider's way of replying",
  }),
  TellBlockSchema,
]).annotate({ expected: 'all, refusals or none, or the tool and with that post a line to the party' });

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

export const RepliesInSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  key: Schema.String,
  reading: Schema.optionalKey(Schema.String),
});

export type DeliveredAs = typeof DeliveredAsSchema.Type;

export type RepliesIn = typeof RepliesInSchema.Type;

export type DeliverBlock = typeof DeliverBlockSchema.Type;

export type Replies = typeof RepliesSchema.Type;

export type TellBlock = typeof TellBlockSchema.Type;

export function tellBlockOf({ tell }: Pick<Replies, 'tell'>): TellBlock | undefined {
  return typeof tell === 'object' ? tell : undefined;
}
