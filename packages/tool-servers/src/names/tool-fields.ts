import { sizeBoundCheck } from '@on.auto/operations';
import { sizeInWords } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { sendLessRemedy, toolBounds } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { serverNamePattern, toolNamePattern } from './tool-reference.ts';

const handArguments = sizeInWords(toolBounds.handArgumentBytes);

function argumentsWithinTheirBound(value: Schema.JsonObject): true | string {
  const bytes = bytesOf(JSON.stringify(value));
  return bytes <= toolBounds.handArgumentBytes
    ? true
    : `The arguments take ${bytes} bytes as JSON, more than the ${handArguments} a call made by hand may send; ${sendLessRemedy}`;
}

export const ServerField = Schema.String.annotate({
  description: 'The tool server, as search names it and a function writes it before the slash',
}).check(Schema.isPattern(serverNamePattern));

export const ToolField = Schema.String.annotate({
  description: 'The tool of that server, as search lists it and a function writes it after the slash',
}).check(Schema.isPattern(toolNamePattern));

export const ArgumentsField = Schema.JsonObject.annotate({
  description: `The arguments of the call, an object in the shape of the tool's input_schema, at most ${handArguments} as JSON`,
}).check(sizeBoundCheck(argumentsWithinTheirBound));

export const NamedToolSchema = Schema.Struct({ server: ServerField, tool: ToolField });
