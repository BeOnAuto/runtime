import { Schema } from 'effect';

import { ArgumentsSchema, callFields } from './event-calls.ts';

export const IdentitySchema = Schema.Struct({
  tool: callFields.tool,
  with: Schema.optionalKey(
    ArgumentsSchema.annotate({ description: 'Beside tool, its arguments, written out as they are' }),
  ),
  method: callFields.method,
  url: Schema.optionalKey(
    Schema.String.annotate({ description: 'Beside method, the https URL of the request, written out whole' }),
  ),
  body: Schema.optionalKey(
    ArgumentsSchema.annotate({
      description: 'Beside method and url, the JSON body of the request, written out as it is',
    }),
  ),
  identified: Schema.Struct({
    id: Schema.String.annotate({ description: "A JSON Pointer into what the call answered, to the account's id" }),
    name: Schema.optionalKey(
      Schema.String.annotate({ description: "A JSON Pointer to the account's name, where the answer gives one" }),
    ),
  }).annotate({ description: 'Where what the call answered names that account' }),
  account: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A JSON Pointer into what the call answered, to the id of the account at the service the connection is for, such as a workspace, where the answer gives one',
    }),
  ),
}).annotate({
  description:
    'The call that asks the service which account the connection acts as, a tool of the connection or an HTTP request',
});
