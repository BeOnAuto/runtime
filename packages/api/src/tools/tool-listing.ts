import { Buffer } from 'node:buffer';

import type { ToolDefinition } from './tool-definition.ts';

export interface ListedTool {
  readonly name: string;
  readonly definition: ToolDefinition;
}

const listedProtocolRequest = 1;

function listedOf({ name, definition }: ListedTool) {
  const { title, description, inputSchema, annotations } = definition;
  const schema = inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  return { name, title, description, inputSchema: { type: 'object', ...schema }, annotations };
}

export function listingBytesOf(tools: readonly ListedTool[]): number {
  const answer = { result: { tools: tools.map((tool) => listedOf(tool)) }, jsonrpc: '2.0', id: listedProtocolRequest };
  return Buffer.byteLength(`event: message\ndata: ${JSON.stringify(answer)}\n\n`);
}
