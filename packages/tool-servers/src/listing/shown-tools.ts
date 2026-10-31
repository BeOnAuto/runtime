import { Predicate, Schema, Struct } from 'effect';

import { cutToDescriptionBound } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { ListedTool } from '../bounds/tool-results.ts';
import type { ServerTool } from './tool-server.ts';

export interface Showing {
  readonly secrets: Secrets;
}

type Scrub = (text: string) => string;

const decodeJsonObject = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));

function scrubbing(scrub: Scrub): (key: string, value: unknown) => unknown {
  return (_key, value) => {
    if (typeof value === 'string') {
      return scrub(value);
    }
    return Predicate.isObject(value)
      ? Object.fromEntries(Object.entries(value).map(([key, item]: readonly [string, unknown]) => [scrub(key), item]))
      : value;
  };
}

function annotationsOf({ annotations = {} }: ListedTool) {
  const hints = Struct.omit(annotations, ['title']);
  return Object.keys(hints).length === 0 ? {} : { annotations: hints };
}

function titleOf({ title, annotations }: ListedTool, scrub: Scrub) {
  const given = title ?? annotations?.title;
  return given === undefined ? {} : { title: scrub(given) };
}

export function scrubbedSchema(inputSchema: Schema.JsonObject, scrub: Scrub): Schema.JsonObject {
  return decodeJsonObject(JSON.stringify(inputSchema, scrubbing(scrub)));
}

export function shownTool(tool: ListedTool, showing: Showing): ServerTool {
  const { name, description = '', inputSchema } = tool;
  const { scrub } = showing.secrets;
  return {
    name: scrub(name),
    ...titleOf(tool, scrub),
    description: cutToDescriptionBound(scrub(description)),
    input_schema: scrubbedSchema(inputSchema, scrub),
    ...annotationsOf(tool),
    ...(tool.answersNoBody === true ? { answersNoBody: true } : {}),
  };
}
