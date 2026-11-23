import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { requiredByChoiceIn } from './required-by-choice.ts';

const approval = {
  type: 'object',
  required: ['verdict'],
  properties: { verdict: { enum: ['approve', 'revise'] }, note: { type: 'string' } },
};

const approve = { properties: { verdict: { const: 'approve' } } };

const revise = { properties: { verdict: { const: 'revise' } }, required: ['note'] };

describe('the choice that decides which other fields an answer needs', () => {
  it('is read from a oneOf or an anyOf of one case for each choice, and leaves the rest of the schema', () => {
    expect(requiredByChoiceIn({ ...approval, anyOf: [approve, revise] })).toEqual({
      rest: approval,
      byChoice: {
        field: 'verdict',
        cases: [
          { field: 'verdict', choice: 'approve', required: [] },
          { field: 'verdict', choice: 'revise', required: ['note'] },
        ],
      },
    });
  });

  it.each<readonly [string, Schema.JsonObject]>([
    ['no oneOf or anyOf', approval],
    ['a oneOf that is not a list', { ...approval, oneOf: true }],
    ['an empty oneOf', { ...approval, oneOf: [] }],
    ['a case that is not an object', { ...approval, oneOf: [approve, true] }],
    ['a case that names no choice', { ...approval, oneOf: [approve, { required: ['note'] }] }],
    ['a case that names no field', { ...approval, oneOf: [approve, { properties: {} }] }],
    ['a case of two fields', { ...approval, oneOf: [approve, { properties: { ...revise.properties, note: {} } }] }],
    ['two cases of one choice', { ...approval, oneOf: [approve, { ...revise, properties: approve.properties }] }],
    ['cases of two fields', { ...approval, oneOf: [approve, { properties: { note: { const: 'x' } } }] }],
    ['a choice that is not text', { ...approval, oneOf: [approve, { properties: { verdict: { const: 1 } } }] }],
    ['a choice with a schema of its own', { ...approval, oneOf: [approve, { properties: { verdict: true } }] }],
    ['a case with more than a requirement', { ...approval, oneOf: [approve, { ...revise, minProperties: 2 }] }],
    [
      'a choice with more than its value',
      { ...approval, oneOf: [approve, { properties: { verdict: { const: 'revise', type: 'string' } } }] },
    ],
    ['a choice the schema does not require', { ...approval, required: [], oneOf: [approve, revise] }],
    ['a schema that is not an object', { ...approval, type: 'array', oneOf: [approve, revise] }],
    ['both a oneOf and an anyOf', { ...approval, oneOf: [approve, revise], anyOf: [approve, revise] }],
  ])('is not read from %s', (_case, document) => {
    expect(requiredByChoiceIn(document)).toBeUndefined();
  });
});
