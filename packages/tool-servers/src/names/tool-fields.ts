import { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { serverNamePattern, toolNamePattern } from './tool-reference.ts';

function argumentsWithinTheirBound(value: Schema.JsonObject): true | string {
  const bytes = bytesOf(JSON.stringify(value));
  return bytes <= toolBounds.argumentBytes
    ? true
    : `The arguments take ${bytes} bytes as JSON, more than the ${toolBounds.argumentBytes} a call may send`;
}

export const ServerField = Schema.String.annotate({
  description: 'The tool server, as search names it and a function writes it before the slash',
}).check(Schema.isPattern(serverNamePattern));

export const ToolField = Schema.String.annotate({
  description: 'The tool of that server, as search lists it and a function writes it after the slash',
}).check(Schema.isPattern(toolNamePattern));

export const ArgumentsField = Schema.JsonObject.annotate({
  description: "The arguments of the call, an object in the shape of the tool's input_schema, at most 16 KiB as JSON",
}).check(Schema.makeFilter(argumentsWithinTheirBound));

export const NamedToolSchema = Schema.Struct({ server: ServerField, tool: ToolField });
