import { Schema } from 'effect';

import { ArgumentsSchema } from './event-calls.ts';

export const PlaceNameSchema = Schema.Struct({
  tool: Schema.String.annotate({
    description:
      'A tool of the connection that reads one place, named as the server lists it. The tool must be marked `reads`.',
  }),
  with: Schema.optionalKey(
    ArgumentsSchema.annotate({
      description:
        "The tool's arguments. Write {{ subject }} where the place goes: it is filled in with the place as the trigger writes it.",
    }),
  ),
  named: Schema.String.annotate({
    description: "A JSON Pointer into what the tool answered, to the place's name.",
  }),
  prefix: Schema.optionalKey(
    Schema.String.annotate({ description: 'Text to put before the name, such as "#" before a channel\'s name.' }),
  ),
}).annotate({
  description:
    "How Auto reads the name the service gives a place, such as a channel's name, where a trigger writes the place as an id. Leave it out where a trigger already writes the place as its name.",
});

export type PlaceName = typeof PlaceNameSchema.Type;
