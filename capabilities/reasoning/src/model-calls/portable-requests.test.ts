import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { exchangedThrough, portableRoutes } from '../provider-testing/portable-routes.ts';
import { readBackAnswers } from '../schema-testing/answer-samples.ts';
import { measuredSchemas } from '../schema-testing/answer-schemas.ts';

const recorded = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)))(
  JSON.parse(readFileSync(new URL('portable-requests.json', import.meta.url), 'utf8')),
);

function recordedRequestOf(route: string, schema: string): unknown {
  return recorded[route]?.[schema];
}

const exchanges = portableRoutes.flatMap((route) =>
  measuredSchemas.map((asked) => [route.name, asked.name, route, asked] as const),
);

describe('a JSON answer asked of a provider that takes schemas', () => {
  it.each(exchanges)(
    'sends %s the portable form of %s, as recorded, and reads the answer back into the schema as written',
    async (routeName, schemaName, route, asked) => {
      const { bodies, result } = await exchangedThrough(route, asked);

      expect(bodies).toEqual([recordedRequestOf(routeName, schemaName)]);
      expect(result).toMatchObject({ json: readBackAnswers[schemaName], output_mode: 'portable' });
    },
  );
});
