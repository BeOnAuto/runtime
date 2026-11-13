import { Effect, Schema } from 'effect';

import { defineCapability } from '../../index.ts';
import { echoDeclaration } from './echo.ts';

const isAJsonObject = Schema.is(Schema.JsonObject);

function objectOf(value: Schema.Json | undefined): Schema.JsonObject {
  return isAJsonObject(value) ? value : {};
}

export const prompted = defineCapability({
  ...echoDeclaration,
  type: 'prompted',
  title: 'Prompted',
  guide: { name: 'prompted' },
  run: ({ greeting }, input) => {
    const given = objectOf(input);
    return Effect.succeed({
      output: { greeting, answer: given['answer'] ?? null },
      record: Object.assign({ greeting }, objectOf(given['record'])),
    });
  },
});
