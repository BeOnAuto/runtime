import { outputShapeOf, type OutputShapeName } from '@on.auto/definitions';
import { Result, type Schema } from 'effect';

import type { JsonOutput, ToolDefinition } from '../model/model-request.ts';
import { compileAnswerSchema, shapedAnswerSchema } from '../schema/answer-schema.ts';
import { citiesSchema, contactCardSchema, outlineSchema, referenceSchema } from './check-schemas.ts';

export type CaseKind = 'portable' | 'described' | 'tools' | 'canary';

export interface CheckCase {
  readonly name: string;
  readonly kind: CaseKind;
  readonly prompt: string;
  readonly output: JsonOutput;
}

function shaped(name: OutputShapeName): JsonOutput {
  const shape = outputShapeOf(name);
  return { type: 'json', schema: shapedAnswerSchema(shape), shape };
}

function written(document: Schema.JsonObject): JsonOutput {
  return { type: 'json', schema: Result.getOrThrow(compileAnswerSchema(document)) };
}

export const cityPopulation: ToolDefinition = {
  name: 'city_population',
  description: 'The population of a city, in millions',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};

export const populations: ReadonlyMap<string, number> = new Map([
  ['Lyon', 0.52],
  ['Lille', 0.24],
]);

const accountFacts = [
  'Review this account and approve a limit of 5000 EUR until 2026-12-31.',
  'Account 9b2f6c1e-4d7a-4f3b-8e21-5c9d0a7b3e44, Northwind Traders, on the pro tier in the emea region, website https://northwind.example.',
  'Its owner is Dana Reyes, dana@northwind.example, +44 20 7946 0000.',
  'It belongs to the Retail division, headed by Lee Park, lee@northwind.example; its Payments department, cost centre PAY-01; and its Checkout team of 12 people, led by Sam Okafor, sam@northwind.example, with a budget of 12000 EUR.',
  'The team sits in Leeds, at 1 Market Street, LS1 6DT, in the Mill building, floor 3, east wing.',
  'It spent 4100 EUR in 2026-09 and 3900 EUR in 2026-10.',
  'Follow up by 2026-12-01; Dana owns the follow-up.',
].join(' ');

export const checkCases: readonly CheckCase[] = [
  {
    name: 'categories',
    kind: 'portable',
    prompt: 'Give the populations of Tokyo, Delhi and Shanghai, in millions of people.',
    output: shaped('categories'),
  },
  {
    name: 'series',
    kind: 'portable',
    prompt:
      'Give the average temperature in Oslo, in degrees Celsius, for each month from January to June 2025, as one line by month.',
    output: shaped('series'),
  },
  {
    name: 'table',
    kind: 'portable',
    prompt:
      'Make a table of the three largest cities of France, with a column for the city and one for its population in millions.',
    output: shaped('table'),
  },
  {
    name: 'text',
    kind: 'portable',
    prompt: 'Say in one sentence why a checklist helps a pilot.',
    output: shaped('text'),
  },
  { name: 'reference', kind: 'portable', prompt: accountFacts, output: written(referenceSchema) },
  {
    name: 'described',
    kind: 'described',
    prompt:
      'Outline a short guide to brewing tea: a title, and two to four sections, one of them with sections of its own.',
    output: written(outlineSchema),
  },
  {
    name: 'tools',
    kind: 'tools',
    prompt:
      'Give the populations of Lyon and Lille, in millions of people. Look each one up with the city_population tool; do not answer from memory.',
    output: shaped('categories'),
  },
  {
    name: 'seventeen_unions',
    kind: 'canary',
    prompt:
      'Fill in the contact card of Ada Lovelace, born 1815-12-10 in London. Leave a field null when it is not known.',
    output: { ...written(contactCardSchema), enforced_as_written: true },
  },
  {
    name: 'large_max_items',
    kind: 'canary',
    prompt: 'Give the populations of the five largest cities of Japan, in millions of people.',
    output: { ...written(citiesSchema), enforced_as_written: true },
  },
];
