import { outputShapeOf } from '@on.auto/definitions';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { budgetOf, portableBudget } from '../schema/portable-checks.ts';
import { portableFormOf } from '../schema/portable-schema.ts';
import { caseOf, everyCase, modelChecked, outcomesOf } from './check-harness.ts';
import { citiesSchema, contactCardSchema, mostShapeValues, outlineSchema, referenceSchema } from './check-schemas.ts';

const anyWords: unknown = expect.any(String);

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

describe('a model whose provider refuses the schema', () => {
  it('has its schemas refused when the enforced request is refused, though the described one answers', async () => {
    const model = await modelChecked('scripted/refusing');
    expect(model.outcome).toBe('schema_refused');
    expect(outcomesOf(model)).toEqual({ ...everyCase('schema_refused'), described: 'passed' });
    expect(caseOf(model, 'reference')).toEqual({
      case: 'reference',
      kind: 'portable',
      outcome: 'schema_refused',
      output_mode: 'described',
      schema_refusal: { outcome: 'described', status: 400 },
      cost_usd: 0.25,
    });
    expect(caseOf(model, 'tools')).toMatchObject({ outcome: 'schema_refused', output_mode: 'described' });
  });

  it('has its schemas refused, not its answers invalid, when the described request misses its schema too', async () => {
    const model = await modelChecked('scripted/refusing-unanswered');
    expect(model.outcome).toBe('schema_refused');
    expect(outcomesOf(model)).toEqual({ ...everyCase('schema_refused'), described: 'invalid' });
    expect(caseOf(model, 'series')).toEqual({
      case: 'series',
      kind: 'portable',
      outcome: 'schema_refused',
      output_mode: 'described',
      detail: 'The answer is not JSON',
      schema_refusal: { outcome: 'described', status: 400 },
      cost_usd: 0.5,
    });
  });

  it('keeps its verdict when only the canaries are refused, since the budget, not the model, decides them', async () => {
    const model = await modelChecked('scripted/bounded');
    expect(model.outcome).toBe('passed');
    expect(outcomesOf(model)).toEqual({
      ...everyCase('passed'),
      seventeen_unions: 'schema_refused',
      large_max_items: 'schema_refused',
    });
  });
});

describe('a model that cannot be asked', () => {
  it('is unreachable when the provider refuses even the described request', async () => {
    const model = await modelChecked('scripted/refusing-all');
    expect(model.outcome).toBe('unreachable');
    expect(outcomesOf(model)).toEqual(everyCase('unreachable'));
    expect(caseOf(model, 'categories')).toMatchObject({
      detail: anyWords,
      status: 400,
      schema_refusal: { outcome: 'refused_again', status: 400 },
    });
    expect(caseOf(model, 'described')).toEqual({
      case: 'described',
      kind: 'described',
      outcome: 'unreachable',
      detail: anyWords,
      status: 400,
      provider_message: "litellm.BadRequestError: Invalid schema for response_format 'response'",
    });
  });

  it('is unreachable when the provider does not serve it', async () => {
    const model = await modelChecked('scripted/missing');
    expect(model.outcome).toBe('unreachable');
    expect(caseOf(model, 'tools')).toEqual({
      case: 'tools',
      kind: 'tools',
      outcome: 'unreachable',
      detail: anyWords,
      status: 404,
      provider_message: 'litellm.NotFoundError: no such model',
    });
  });
});

describe('a model that is not there for now', () => {
  it('is unavailable when the provider limits its requests', async () => {
    const model = await modelChecked('scripted/limited');
    expect(model.outcome).toBe('unavailable');
    expect(caseOf(model, 'series')).toEqual({
      case: 'series',
      kind: 'portable',
      outcome: 'unavailable',
      detail: 'scripted is limiting the rate of requests',
    });
  });

  it('is unavailable when its call fails in a way the runtime does not classify', async () => {
    const model = await modelChecked('scripted/broken');
    expect(model.outcome).toBe('unavailable');
    expect(caseOf(model, 'table')).toEqual({
      case: 'table',
      kind: 'portable',
      outcome: 'unavailable',
      detail: anyWords,
    });
  });
});
