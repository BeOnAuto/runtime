import { outputShapeNamed, outputShapeOf, type OutputShapeName } from '@on.auto/definitions';
import type { SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import type { JsonOutput } from '../model/model-request.ts';
import { compileAnswerSchema, shapedAnswerSchema } from '../schema/answer-schema.ts';

export interface AnswerSchemaCase {
  readonly name: string;
  readonly document: Schema.JsonObject;
  readonly issues: readonly SchemaIssue[];
}

export const ticketSchema: Schema.JsonObject = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['billing', 'technical', 'account', 'other'] },
    priority: { type: 'integer', enum: [1, 2, 3, 4], description: '1 is the most urgent' },
    customer: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
      },
      required: ['name'],
      additionalProperties: false,
    },
    summary: { type: 'string', maxLength: 80 },
    follow_up: {
      type: 'object',
      properties: { needed: { type: 'boolean' }, by: { type: 'string', format: 'date' } },
      required: ['needed'],
      additionalProperties: false,
    },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['category', 'priority', 'customer', 'summary'],
  additionalProperties: false,
};

export const invoiceSchema: Schema.JsonObject = {
  type: 'object',
  properties: {
    invoice_id: { type: 'string', format: 'uuid' },
    issued: { type: 'string', format: 'date' },
    vendor_site: { type: 'string', format: 'uri' },
    lines: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', minLength: 1 },
          quantity: { type: 'integer', minimum: 1 },
          unit_price: { type: 'number', minimum: 0 },
        },
        required: ['description', 'quantity', 'unit_price'],
        additionalProperties: false,
      },
    },
    total: { type: 'number', minimum: 0 },
    currency: { type: 'string', enum: ['EUR', 'USD', 'GBP'] },
    notes: { type: 'string' },
  },
  required: ['invoice_id', 'issued', 'vendor_site', 'lines', 'total', 'currency'],
  additionalProperties: false,
};

export const decisionSchema: Schema.JsonObject = {
  type: 'object',
  $defs: {
    money: {
      type: 'object',
      properties: { amount: { type: 'number' }, currency: { type: 'string' } },
      required: ['amount', 'currency'],
      additionalProperties: false,
    },
  },
  properties: {
    verdict: {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { const: 'approve' }, limit: { $ref: '#/$defs/money' } },
          required: ['kind', 'limit'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { const: 'reject' }, reason: { type: 'string' } },
          required: ['kind', 'reason'],
          additionalProperties: false,
        },
      ],
    },
    reviewer_note: { type: 'string' },
  },
  required: ['verdict'],
  additionalProperties: false,
};

export const scoresSchema: Schema.JsonObject = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      additionalProperties: { type: 'number', minimum: 0, maximum: 10 },
      description: 'Each candidate by name, and their score',
    },
    winner: { type: 'string' },
  },
  required: ['scores', 'winner'],
  additionalProperties: false,
};

export const place: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['city'],
  properties: { city: { type: 'string' } },
};

function stringProperties(names: readonly string[]): Schema.JsonObject {
  return Object.fromEntries(names.map((name) => [name, { type: 'string' }]));
}

export function withOptionalStrings(required: string, optional: readonly string[]): Schema.JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: [required],
    properties: stringProperties([required, ...optional]),
  };
}

function shapeCase(name: OutputShapeName): AnswerSchemaCase {
  return { name, document: outputShapeOf(name).schema, issues: [] };
}

export const measuredSchemas: readonly AnswerSchemaCase[] = [
  shapeCase('categories'),
  shapeCase('series'),
  shapeCase('table'),
  shapeCase('text'),
  { name: 'ticket', document: ticketSchema, issues: [] },
  { name: 'invoice', document: invoiceSchema, issues: [] },
  { name: 'decision', document: decisionSchema, issues: [] },
  { name: 'scores', document: scoresSchema, issues: [] },
];

export function jsonOutputOf({ name, document }: AnswerSchemaCase): JsonOutput {
  const shape = outputShapeNamed(name);
  return shape === undefined
    ? { type: 'json', schema: Result.getOrThrow(compileAnswerSchema(document)) }
    : { type: 'json', schema: shapedAnswerSchema(shape), shape };
}
