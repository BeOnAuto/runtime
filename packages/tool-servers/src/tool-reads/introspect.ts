import { defineQuery } from '@on.auto/operations';
import { Effect, Schema, Struct } from 'effect';

import { ToolAnnotationsSchema } from '../bounds/tool-results.ts';
import { NamedToolSchema } from '../names/tool-fields.ts';
import { namedToolOf, type ToolLookup } from './named-tool.ts';
import { introspected, readingTask, toolRead } from './read-words.ts';
import { toolRemedies } from './tool-refusals.ts';

const description = [
  "Describes one tool of a tool server this playbook's functions may use, whole: what it does, the JSON Schema of the arguments it takes and the hints its server gives it.",
  'Use it once search has found a tool, before writing its arguments or naming it in the tools of a function as server/tool.',
  'Its server is asked for its tools when this is called, and nothing is sent to the tool; dry_run checks arguments against the schema and execute calls it.',
  '`server` and `tool` name the tool as search lists it.',
].join(' ');

const ToolDescribedSchema = Schema.Struct({
  server: Schema.String.annotate({ description: 'The tool server, as given' }),
  tool: Schema.String.annotate({ description: 'The tool, as given' }),
  description: Schema.String.annotate({
    description: 'What the tool does, as its server describes it, cut to 4 KiB; empty when it gives none',
  }),
  input_schema: Schema.JsonObject.annotate({
    description: 'The JSON Schema of the arguments the tool takes, as its server gives it',
  }),
  annotations: Schema.optionalKey(
    ToolAnnotationsSchema.annotate({
      description:
        'The hints its server gives the tool, readOnlyHint, destructiveHint, idempotentHint and openWorldHint, as it gives them; absent when it gives none',
    }),
  ),
});

export function defineIntrospect(access: ToolLookup) {
  return defineQuery('playbook', {
    name: 'introspect',
    title: 'Introspect a tool',
    description,
    route: { method: 'GET', path: '/tool-servers/{server}/tools/{tool}' },
    reachesOutside: true,
    inputSchema: NamedToolSchema,
    outputSchema: ToolDescribedSchema,
    reasons: ['unavailable'],
    handle: Effect.fnUntraced(function* ({ server, tool }) {
      return { server, tool, ...Struct.omit(yield* namedToolOf(access, { server, tool }), ['name', 'title']) };
    }),
    plainLanguage: {
      task: readingTask.introspect,
      attempt: (asked) => toolRead('describe', asked),
      outcome: (described) => introspected(described),
      remedies: toolRemedies,
    },
  });
}
