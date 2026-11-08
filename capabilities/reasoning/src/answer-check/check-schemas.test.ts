import { outputShapeOf } from '@on.auto/definitions';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { budgetOf, portableBudget } from '../schema/portable-checks.ts';
import { portableFormOf } from '../schema/portable-schema.ts';
import { citiesSchema, contactCardSchema, mostShapeValues, outlineSchema, referenceSchema } from './check-schemas.ts';

function portabilityOf(document: Schema.JsonObject) {
  return portableFormOf(Result.getOrThrow(compileAnswerSchema(document)));
}

describe('the schemas of the answer check', () => {
  it('holds the reference schema to the budget exactly: 16 fields that may be null or are a choice, and 10 levels', () => {
    const form = portabilityOf(referenceSchema);
    expect(form).toMatchObject({
      portable: true,
      budget: { unions: portableBudget.unions, depth: portableBudget.depth },
    });
  });

  it('gives the reference schema every construct the portable form rewrites', () => {
    const written = JSON.stringify(referenceSchema);
    for (const construct of ['"oneOf"', '"$defs"', '"$ref"', '"format":"uuid"', '"format":"email"', '"maxLength"']) {
      expect(written).toContain(construct);
    }
    expect(referenceSchema).toMatchObject({
      properties: { review: { properties: { spend: { additionalProperties: { $ref: '#/$defs/money' } } } } },
    });
  });

  it('describes the outline on every route, since its sections refer to themselves', () => {
    expect(portabilityOf(outlineSchema)).toMatchObject({ portable: false });
  });

  it('gives the contact card one field that may be null more than the budget allows', () => {
    expect(budgetOf(contactCardSchema).unions).toBe(portableBudget.unions + 1);
    expect(portabilityOf(contactCardSchema)).toMatchObject({ portable: false });
  });

  it('bounds the cities canary by the most values the categories shape takes', () => {
    expect(outputShapeOf('categories').schema).toMatchObject({
      properties: { values: { maxItems: mostShapeValues } },
    });
    expect(citiesSchema).toMatchObject({ properties: { values: { maxItems: mostShapeValues } } });
  });
});
