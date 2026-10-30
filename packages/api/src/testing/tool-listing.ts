import { Schema } from 'effect';

import { withPlaybookArgument } from '../tools/playbook-argument.ts';

const ListedToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  outputSchema: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type ListedTool = typeof ListedToolSchema.Type;

const toolsOf = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(ListedToolSchema) }));

export function listedTools(listing: unknown): readonly ListedTool[] {
  return toolsOf(listing).tools;
}

export function toolNamesIn(listing: unknown): readonly string[] {
  return listedTools(listing).map(({ name }) => name);
}

export const guideToolName = 'get_guide';

export function operationToolsIn(listing: unknown): readonly ListedTool[] {
  return listedTools(listing).filter(({ name }) => name !== guideToolName);
}

export function takingPlaybook({ inputSchema, ...tool }: ListedTool): ListedTool {
  return { ...tool, inputSchema: withPlaybookArgument(inputSchema) };
}
