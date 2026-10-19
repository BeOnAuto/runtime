import type { RouteRegistration } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { makeDefinitionOperations } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';

const operations = makeDefinitionOperations([echo, probe().capability]);

function registrationOf(name: string): RouteRegistration {
  const found = operations.find(({ registration }) => registration.name === name);
  if (found === undefined) {
    throw new Error(`There is no operation ${name}`);
  }
  return found.registration;
}

function outcomeOf(name: string, output: unknown, input: unknown): string | undefined {
  return registrationOf(name).plainLanguage?.outcome(output, input);
}

function attemptOf(name: string, input: unknown): string | undefined {
  return registrationOf(name).plainLanguage?.attempt(input);
}

const greet = {
  type: 'echo',
  name: 'greet',
  version: 1,
  status: 'active',
  media_type: 'application/json',
  source: '{"greeting":"Hello"}',
  overview: '# greet\n\nThis greeting has no description yet.\n',
  created_at: '2026-10-02T09:00:00.000Z',
  created_by: 'acme-admin',
  updated_at: '2026-10-02T09:00:00.000Z',
};

const greetInput = { type: 'echo', name: 'greet', source: '{"greeting":"Hello"}' };

function listed(definition: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(definition).filter(([key]: readonly [string, unknown]) => key !== 'source' && key !== 'overview'),
  );
}

const describing: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>, string]> = [
  ['its description', { description: 'Greets the caller' }, ' What it does: Greets the caller.'],
  [
    'what it takes and gives back',
    {
      input_schema: { type: 'object', properties: { customer_name: { type: 'string' } } },
      output_schema: { type: 'object', properties: { greeting: {}, sentAt: {} } },
    },
    ' It takes customer name, and gives back greeting and sent at.',
  ],
  ['only what it takes', { input_schema: { properties: { text: {} } } }, ' It takes text.'],
  ['only what it gives back', { output_schema: { properties: { verdict: {} } } }, ' It gives back verdict.'],
  ['nothing when its schemas name no fields', { input_schema: { type: 'object' } }, ''],
];

describe('the plain language of create_definition', () => {
  it.each(describing)('says what the new definition does from %s', (_case, content, words) => {
    expect(outcomeOf('create_definition', { ...greet, ...content }, greetInput)).toBe(
      `Created the greeting “greet”.${words} It has been saved but has not been run yet.`,
    );
  });

  it('names the definition it tried to create in the words of its capability, or what it tried for a type the server does not run', () => {
    expect([
      attemptOf('create_definition', greetInput),
      attemptOf('create_definition', { ...greetInput, type: 'nowhere' }),
      attemptOf('create_definition', { name: 'greet' }),
    ]).toEqual(['create the greeting “greet”', 'create a new greeting or probe', 'create a new greeting or probe']);
  });
});

describe('the plain language of update_definition', () => {
  it('says the change applies from the next run', () => {
    expect(outcomeOf('update_definition', { ...greet, version: 2, description: 'Greets' }, greetInput)).toBe(
      'Updated the greeting “greet”. What it does: Greets. The change applies from its next run.',
    );
  });

  it('names the definition it tried to update', () => {
    expect([attemptOf('update_definition', greetInput), attemptOf('update_definition', {})]).toEqual([
      'update the greeting “greet”',
      'update a greeting or probe',
    ]);
  });
});

describe('the plain language of get_definition', () => {
  it('says whether the definition is in use and what it does', () => {
    expect([
      outcomeOf('get_definition', { ...greet, description: 'Greets' }, { type: 'echo', name: 'greet' }),
      outcomeOf('get_definition', { ...greet, status: 'retired' }, { type: 'echo', name: 'greet' }),
    ]).toEqual([
      'The greeting “greet” is in use. What it does: Greets.',
      'The greeting “greet” has been retired; it can no longer be run or changed.',
    ]);
  });

  it('names the definition it looked for', () => {
    expect([attemptOf('get_definition', { type: 'probe', name: 'plain' }), attemptOf('get_definition', {})]).toEqual([
      'look up the probe “plain”',
      'look up a greeting or probe',
    ]);
  });
});

function greeting(name: string, status = 'active'): Readonly<Record<string, unknown>> {
  return listed({ ...greet, name, status });
}

const definitionListings: ReadonlyArray<readonly [readonly unknown[], string]> = [
  [[], 'This playbook has no greetings in use yet.'],
  [[greeting('greet')], 'This playbook has 1 greeting: “greet”.'],
  [[greeting('greet'), greeting('wave')], 'This playbook has 2 greetings: “greet” and “wave”.'],
  [
    [greeting('greet'), greeting('old', 'retired')],
    'This playbook has 1 greeting: “greet”. Also listed, 1 retired greeting: “old”.',
  ],
];

describe('the plain language of list_definitions', () => {
  it.each(definitionListings)('describes %j', (definitions, words) => {
    expect(outcomeOf('list_definitions', { definitions }, { type: 'echo' })).toBe(words);
  });

  it('names at most twenty definitions and counts the rest', () => {
    const definitions = Array.from({ length: 21 }, (_, index) => greeting(`greet-${index}`));

    expect(outcomeOf('list_definitions', { definitions }, { type: 'echo' })).toMatch(/“greet-19”, and 1 more\.$/u);
  });

  it('names the kind of definition it tried to list', () => {
    expect([attemptOf('list_definitions', { type: 'probe' }), attemptOf('list_definitions', {})]).toEqual([
      'list the probes',
      'list the greetings and probes',
    ]);
  });
});

describe('the plain language of retire_definition', () => {
  it('says the definition can no longer be run or changed, nor its name used again', () => {
    expect(outcomeOf('retire_definition', { ...greet, status: 'retired' }, { type: 'echo', name: 'greet' })).toBe(
      'Retired the greeting “greet”. It can no longer be run or changed, and its name cannot be used again in this playbook.',
    );
  });

  it('names the definition it tried to retire', () => {
    expect([
      attemptOf('retire_definition', { type: 'echo', name: 'greet' }),
      attemptOf('retire_definition', {}),
    ]).toEqual(['retire the greeting “greet”', 'retire a greeting or probe']);
  });
});
