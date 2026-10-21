import { Option, Result, Schema } from 'effect';

import { bodyTextOf } from '../operations/request-body.ts';

const RequestIdSchema = Schema.Union([Schema.String, Schema.Number]);

export const DroppedArgumentSchema = Schema.Struct({ id: RequestIdSchema, value: Schema.Unknown });

export type DroppedArgument = typeof DroppedArgumentSchema.Type;

const ToolCallSchema = Schema.Struct({
  id: RequestIdSchema,
  method: Schema.Literal('tools/call'),
  params: Schema.Struct({ arguments: Schema.Record(Schema.String, Schema.Unknown) }),
});

const toolCallOf = Schema.decodeUnknownOption(ToolCallSchema);

const batchOf = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

const droppedKey = '__proto__';

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function droppedArgumentOf(message: unknown): readonly DroppedArgument[] {
  return Option.match(toolCallOf(message), {
    onNone: () => [],
    onSome: ({ id, params }) =>
      Object.hasOwn(params.arguments, droppedKey) ? [{ id, value: params.arguments[droppedKey] }] : [],
  });
}

export async function postedMessagesOf(request: Request): Promise<readonly unknown[]> {
  const text = await bodyTextOf(request.clone());
  const body = Result.isSuccess(text) ? parsed(text.success) : undefined;
  return Option.getOrElse(batchOf(body), () => [body]);
}

export function droppedArgumentsIn(messages: readonly unknown[]): readonly DroppedArgument[] {
  return messages.flatMap((message) => droppedArgumentOf(message));
}

export function withDroppedArgument(
  input: Readonly<Record<string, unknown>>,
  dropped?: DroppedArgument,
): Readonly<Record<string, unknown>> {
  return dropped === undefined ? input : Object.fromEntries([...Object.entries(input), [droppedKey, dropped.value]]);
}
