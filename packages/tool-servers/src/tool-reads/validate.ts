import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ArgumentsField, ServerField, ToolField } from '../names/tool-fields.ts';
import { ArgumentCheckSchema, checkedArguments } from './argument-checks.ts';
import { namedToolOf, type ToolLookup } from './named-tool.ts';

const description = [
  'Checks arguments against the input schema of one tool of a tool server, without calling the tool, and answers whether they match and where they do not.',
  'Use it before execute, or before a function relies on the arguments it writes.',
  'Its server is asked for its tools when this is called, nothing is sent to the tool and nothing is recorded.',
  "A schema this server's checker cannot take answers valid null, with one issue saying why.",
  '`server` and `tool` name the tool as search lists it, and `arguments` is the object to check.',
].join(' ');

const ValidateInputSchema = Schema.Struct({ server: ServerField, tool: ToolField, arguments: ArgumentsField });

export function defineValidate(access: ToolLookup) {
  return defineHttpOperation('playbook', 'query', {
    name: 'validate',
    title: 'Validate arguments',
    description,
    route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/validate' },
    body: { kind: 'json' },
    inputSchema: ValidateInputSchema,
    outputSchema: ArgumentCheckSchema,
    reasons: ['unavailable'],
    handle: Effect.fnUntraced(function* ({ server, tool, arguments: input }) {
      const { input_schema } = yield* namedToolOf(access, { server, tool });
      return checkedArguments(input_schema, input);
    }),
  });
}
