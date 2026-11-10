import type { RouteRegistration } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, makeDefinitionOperations, type Capability } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { runContentHolders } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';

const operations = makeDefinitionOperations([echo, probe().capability], uncheckedPages, { holders: runContentHolders });

function presenting(type: string, noun: string): Capability {
  return defineCapability({
    type,
    title: noun,
    guide: { name: type },
    noun: { one: noun, other: `${noun}s` },
    describeOutput: () => 'It ran.',
    mediaType: 'text/markdown',
    parse: () => Effect.succeed({}),
    summarize: () => ({}),
    run: () => Effect.succeed({ output: null, record: {} }),
  });
}

const presentingOperations = makeDefinitionOperations(
  [presenting('reasoning', 'reasoning function'), presenting('workflow', 'workflow')],
  uncheckedPages,
  { holders: runContentHolders },
);

function registrationOf(name: string, served = operations): RouteRegistration {
  const found = served.find(({ registration }) => registration.name === name);
  if (found === undefined) {
    throw new Error(`There is no operation ${name}`);
  }
  return found.registration;
}

function outcomeOf(name: string, output: unknown, input: unknown): string | undefined {
  return registrationOf(name).plainLanguage?.outcome(output, input);
}

function savedOutcomeOf(name: string, type: string, source: string): string | undefined {
  return registrationOf(name, presentingOperations).plainLanguage?.outcome(
    { ...greet, type, name: 'review', media_type: 'text/markdown', source },
    { type, name: 'review', source },
  );
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
  overview: 'Greets each guest who arrives at the front desk.',
  created_at: '2026-10-02T09:00:00.000Z',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
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

const noPageYet = 'It has no page yet; the page guide says how to give it one.';

const functionWithoutAPage = '---\nmodel: anthropic/claude-sonnet-4-5\n---\nReview this brief.\n';

const functionWithAPage =
  '---\nmodel: anthropic/claude-sonnet-4-5\npage:\n  result: |\n    {{ output }}\n---\nReview this brief.\n';

const functionWithAnEmptyPage = '---\nmodel: anthropic/claude-sonnet-4-5\npage: {}\n---\nReview this brief.\n';

const workflowWithoutAPage = "document:\n  dsl: '1.0.3'\ndo: []\n";

const workflowWithAPage = "document:\n  dsl: '1.0.3'\ndo: []\npage:\n  result: |\n    Reviewed.\n";

describe('the plain language of saving a workflow or a function without a page', () => {
  it('ends, for a function saved without one or with an empty one, by saying it has no page yet and where to learn how to give it one', () => {
    expect([
      savedOutcomeOf('create_definition', 'reasoning', functionWithoutAPage),
      savedOutcomeOf('create_definition', 'reasoning', functionWithAnEmptyPage),
      savedOutcomeOf('update_definition', 'reasoning', functionWithoutAPage),
    ]).toEqual([
      `Created the reasoning function “review”. It has been saved but has not been run yet. ${noPageYet}`,
      `Created the reasoning function “review”. It has been saved but has not been run yet. ${noPageYet}`,
      `Updated the reasoning function “review”. The change applies from its next run. ${noPageYet}`,
    ]);
  });

  it('ends so for a workflow saved without one', () => {
    expect([
      savedOutcomeOf('create_definition', 'workflow', workflowWithoutAPage),
      savedOutcomeOf('update_definition', 'workflow', workflowWithoutAPage),
    ]).toEqual([
      `Created the workflow “review”. It has been saved but has not been run yet. ${noPageYet}`,
      `Updated the workflow “review”. The change applies from its next run. ${noPageYet}`,
    ]);
  });

  it('says nothing of a page where the workflow or the function has one, nor for a type that is neither', () => {
    expect([
      savedOutcomeOf('create_definition', 'reasoning', functionWithAPage),
      savedOutcomeOf('update_definition', 'reasoning', functionWithAPage),
      savedOutcomeOf('create_definition', 'workflow', workflowWithAPage),
      savedOutcomeOf('update_definition', 'workflow', workflowWithAPage),
      outcomeOf('create_definition', greet, greetInput),
    ]).toEqual([
      'Created the reasoning function “review”. It has been saved but has not been run yet.',
      'Updated the reasoning function “review”. The change applies from its next run.',
      'Created the workflow “review”. It has been saved but has not been run yet.',
      'Updated the workflow “review”. The change applies from its next run.',
      'Created the greeting “greet”. It has been saved but has not been run yet.',
    ]);
  });
});

describe('the plain language of get_definition', () => {
  it('says whether the definition is in use and what it does', () => {
    expect([
      outcomeOf('get_definition', { ...greet, description: 'Greets' }, { type: 'echo', name: 'greet' }),
      outcomeOf('get_definition', { ...greet, status: 'paused' }, { type: 'echo', name: 'greet' }),
      outcomeOf('get_definition', { ...greet, status: 'retired' }, { type: 'echo', name: 'greet' }),
    ]).toEqual([
      'The greeting “greet” is in use. What it does: Greets.',
      'The greeting “greet” is paused; it starts no runs until it is resumed.',
      'The greeting “greet” is retired; it neither runs nor changes until it is restored.',
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
  [
    [greeting('greet'), greeting('hold', 'paused'), greeting('wait', 'paused')],
    'This playbook has 1 greeting: “greet”, and 2 paused greetings: “hold” and “wait”.',
  ],
  [
    [greeting('hold', 'paused'), greeting('old', 'retired')],
    'This playbook has 1 paused greeting: “hold”. Also listed, 1 retired greeting: “old”.',
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
  it('says the definition neither runs nor changes until it is restored, and that its name stays its own', () => {
    expect(outcomeOf('retire_definition', { ...greet, status: 'retired' }, { type: 'echo', name: 'greet' })).toBe(
      'Retired the greeting “greet”. It neither runs nor changes until it is restored, and no other definition takes its name.',
    );
  });

  it('names the definition it tried to retire', () => {
    expect([
      attemptOf('retire_definition', { type: 'echo', name: 'greet' }),
      attemptOf('retire_definition', {}),
    ]).toEqual(['retire the greeting “greet”', 'retire a greeting or probe']);
  });
});

describe('the attempt of a read that renders a page', () => {
  const read = registrationOf('get_definition').plainLanguage;

  it('names the definition whose page it renders, even where its input is refused', () => {
    expect([
      read?.attempt({ type: 'echo', name: 'greet', render: true, sample_output: 'x'.repeat(262_145) }),
      read?.attempt({ type: 'echo', name: 'greet', render: true }),
      read?.attempt({ type: 'echo', name: 'greet' }),
    ]).toEqual(['render the greeting “greet”', 'render the greeting “greet”', 'look up the greeting “greet”']);
  });

  it('names the definition a run is asked of, even where its input is refused', () => {
    expect(registrationOf('run_definition').plainLanguage?.attempt({ type: 'echo', name: 'greet', run_id: 'no' })).toBe(
      'run the greeting “greet”',
    );
  });

  it('falls back to the task where the input names no type the server keeps', () => {
    expect([read?.attempt({ type: 'forecast', name: 'greet' }), read?.attempt({})]).toEqual([
      read?.attempt(null),
      read?.attempt(null),
    ]);
  });
});
