import { readFileSync } from 'node:fs';

import { defineCapability, type Capability, type CapabilityGuide } from '@on.auto/definitions';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { apiShippedRoots, mostGuideBytes, mostRecipeBytes, type GuideShelf } from '../index.ts';
import { withLinksResolved } from './page-links.ts';
import { guideShelfFrom } from './served-guides.ts';
import { withoutSiteMarkup } from './site-markup.ts';

const guideFiles = shippedFilesOnDisk(apiShippedRoots());

function capabilityOf(name: string, noun: string, guide: CapabilityGuide): Capability {
  return defineCapability({
    type: name,
    title: noun,
    guide,
    noun: { one: noun, other: `${noun}s` },
    describeOutput: () => 'It ran.',
    mediaType: 'text/markdown',
    parse: () => Effect.succeed({}),
    summarize: () => ({}),
    run: () => Effect.succeed({ output: null, record: {} }),
  });
}

const onThisServer = 'On this server, a reasoning function names its model through anthropic.';

const reasoning = capabilityOf('reasoning', 'reasoning function', { name: 'reasoning-function', onThisServer });

const computation = capabilityOf('computation', 'computation function', { name: 'computation-function' });

const prediction = capabilityOf('prediction', 'prediction function', { name: 'prediction-function' });

const workflow = capabilityOf('workflow', 'workflow', { name: 'workflow' });

const everyType = [reasoning, computation, prediction, workflow];

const interaction = capabilityOf('interaction', 'interaction function', { name: 'interaction-function' });

const served = await guideShelfFrom(guideFiles, everyType, { pages: false });

const servedWithInteraction = await guideShelfFrom(guideFiles, [...everyType, interaction], { pages: false });

const servedForReasoningAndWorkflows = await guideShelfFrom(guideFiles, [reasoning, workflow], { pages: false });

const servedForReasoning = await guideShelfFrom(guideFiles, [reasoning], { pages: false });

const servedWithEverything = await guideShelfFrom(guideFiles, [...everyType, interaction], { pages: true });

const lookup = capabilityOf('lookup', 'lookup function', { name: 'lookup-function' });

const servedWithLookupAndPages = await guideShelfFrom(guideFiles, [reasoning, lookup, workflow], { pages: true });

function recipeTextsOf({ recipes }: GuideShelf): Readonly<Record<string, string>> {
  return Object.fromEntries(recipes.map(({ name, text }) => [name, text]));
}

function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function bytesOf(texts: Readonly<Record<string, string>>, ...names: readonly string[]): readonly number[] {
  return names.map((name) => byteLengthOf(texts[name] ?? ''));
}

function page(path: string): string {
  return readFileSync(new URL(`../../../../docs/${path}`, import.meta.url), 'utf8');
}

function outsideCode(text: string): string {
  return text
    .split(/^```/mu)
    .filter((_, index) => index % 2 === 0)
    .join('');
}

const pages: Readonly<Record<string, string>> = {
  'reasoning-function': 'reference/reasoning-format.md',
  'prediction-function': 'reference/prediction-format.md',
  'computation-function': 'reference/computation-format.md',
  workflow: 'reference/workflow-format.md',
  templates: 'reference/template.md',
};

describe('the guides of a server that runs every type of definition', () => {
  const { definitionTypes, guides, recipes } = served;

  it('are the terminology, a guide per type in the order of the product whatever order the types are given in, the templates and the three recipes it carries the format guides of', () => {
    expect([...guides, ...recipes].map(({ name }) => name)).toEqual([
      'terminology',
      ...Object.keys(pages),
      'first-playbook',
      'give-tools',
      'schedule',
    ]);
    expect(definitionTypes).toEqual([
      { type: 'reasoning', noun: 'reasoning function', guide: 'reasoning-function' },
      { type: 'prediction', noun: 'prediction function', guide: 'prediction-function' },
      { type: 'computation', noun: 'computation function', guide: 'computation-function' },
      { type: 'workflow', noun: 'workflow', guide: 'workflow' },
    ]);
  });

  it('give each type the whole public page of its format and the templates guide the page of templates, without the markup of the documentation site, their links resolved, and the reasoning page what this server offers', () => {
    const [reasoningGuide, ...otherGuides] = guides.slice(1);
    const [reasoningPage = '', ...otherPages] = Object.values(pages);

    expect(reasoningGuide?.text).toBe(
      `${withLinksResolved(withoutSiteMarkup(page(reasoningPage)), reasoningPage).trimEnd()}\n\n${onThisServer}\n`,
    );
    expect(otherGuides.map(({ text }) => text)).toEqual(
      otherPages.map((path) => withLinksResolved(withoutSiteMarkup(page(path)), path)),
    );
  });
});

describe('the titles and links of the guides of a server that runs every type of definition', () => {
  const { guides } = served;

  it('title each type guide and the templates as their pages are titled', () => {
    expect(guides.slice(1).map(({ title }) => title)).toEqual([
      'Reasoning function format',
      'Prediction function format',
      'Computation function format',
      'Workflow format',
      'Templates',
    ]);
  });

  it('keep no link a reader of the guide could not follow', () => {
    expect(guides.filter(({ text }) => /\]\((?!https:\/\/)[^)]*\)/u.test(outsideCode(text)))).toEqual([]);
  });
});

describe('the text of the guides of a server', () => {
  it('holds none of the markup the documentation site needs', () => {
    const { guides } = served;

    expect(
      guides.filter(({ text }) => /^<div v-pre>|^<\/div>$|^<!-- prettier-ignore -->$/mu.test(outsideCode(text))),
    ).toEqual([]);
  });
});

describe('the size and the words of the guides of a server', () => {
  const { guides, recipes } = served;

  it('stay under 64 KiB each, the guide of interaction functions among them, and each recipe under 5 KiB', () => {
    const everyGuide = servedWithEverything.guides;

    expect(everyGuide.map(({ name }) => name)).toContain('interaction-function');
    expect(everyGuide.filter(({ text }) => byteLengthOf(text) > mostGuideBytes)).toEqual([]);
    expect(recipes.filter(({ text }) => byteLengthOf(text) > mostRecipeBytes)).toEqual([]);
    expect(servedWithEverything.recipes.filter(({ text }) => byteLengthOf(text) > mostRecipeBytes)).toEqual([]);
  });

  it('carry the page guide beside the templates where the server keeps pages, and say so', () => {
    expect([served.pages, servedWithEverything.pages, servedWithEverything.named('page')?.title]).toEqual([
      false,
      true,
      'Page format',
    ]);
  });

  it('describe each guide in a sentence for a person or a client that lists them', () => {
    expect(guides.slice(1).map(({ description }) => description)).toEqual([
      'How reasoning functions are written: their document, fields, examples and bounds.',
      'How prediction functions are written: their document, fields, examples and bounds.',
      'How computation functions are written: their document, fields, examples and bounds.',
      'How workflows are written: their document, fields, examples and bounds.',
      'The filters a template may use, the same in every template of every definition.',
    ]);
  });
});

describe('the recipes of a server', () => {
  it('leave out a recipe whose format guide the server does not carry', () => {
    expect(servedForReasoningAndWorkflows.recipes.map(({ name }) => name)).toEqual([
      'first-playbook',
      'give-tools',
      'schedule',
    ]);
  });

  it('are none for a server that runs no type of definition', async () => {
    expect((await guideShelfFrom(guideFiles, [], { pages: false })).recipes).toEqual([]);
  });

  it('ask the person in their own words, filled into what the prompt asks for', () => {
    const asked = Object.fromEntries(served.recipes.map(({ name, request }) => [name, request]));

    expect([
      asked['first-playbook']?.({}),
      asked['give-tools']?.({}),
      asked['give-tools']?.({ server: 'slack' }),
      asked['schedule']?.({ workflow: 'daily-digest', when: 'every weekday at 9:00' }),
    ]).toEqual([
      'Create my first playbook.',
      'Give the playbook tools.',
      'Give the playbook the tools of the tool server slack.',
      'Run the workflow daily-digest every weekday at 9:00.',
    ]);
  });
});

describe('the recipes that give a playbook tools', () => {
  it('call a tool to learn what it answers, and never make a function to look, within the bound of a recipe', () => {
    const texts = recipeTextsOf(served);

    expect(String(texts['give-tools'])).toContain(
      "4. To learn what a tool answers, call it with the arguments its input_schema takes and read its `text`: that is what the function's model will see. Never make a function to look. Call a tool whose `mark` is reads with query_connection. A tool whose `mark` is acts or unmarked may change something, so call it with execute_connection, and only once the person agrees. When a prompt needs an id, such as a channel's, call the tool that lists them and take the id from its answer, confirming the choice with the person.",
    );
    expect(String(texts['give-tools'])).toContain(
      'the org it serves, with `allowed` naming the tools a function may call. The server reads them when it starts again.',
    );
    expect(String(texts['first-playbook'])).toContain(
      "When it should use a tool server's tools, follow the give-tools recipe: to learn what a tool answers, call it with query_connection, and never make a function to look.",
    );
    expect([byteLengthOf(String(texts['give-tools'])), byteLengthOf(String(texts['first-playbook']))]).toEqual([
      3701, 4011,
    ]);
  });
});

describe('the recipes of a server that serves interaction functions', () => {
  it('send a message a person answers to an interaction function, words a server without them does not serve', () => {
    const texts = recipeTextsOf(servedWithInteraction);

    expect(texts['give-tools']).toContain(
      "5. Ask the person what the function should do with the tools, and which of them it needs. To act on a system, write an interaction function that calls the connection's tool with `call` instead: it answers at once and spends no model call, and its guide says how to write it from the answer execute_connection gave. Keep a reasoning function's `tools` for judgement over what the tools answer. To ask a person and take their answer, write an interaction function too: ask once where they want to be asked, then name in `deliver` the connection's tool that sends the request and in `replies` the one that reads the replies, or write `deliver: agent`; the interaction-function guide says how.\n",
    );
    expect(texts['first-playbook']).toContain(
      'give it tools with the give-tools recipe. They can also ask someone through a connection and take their answer with an interaction function.',
    );
    expect([
      bytesOf(texts, 'first-playbook', 'give-tools', 'schedule'),
      bytesOf(recipeTextsOf(served), 'first-playbook', 'give-tools', 'schedule'),
    ]).toEqual([
      [4470, 4301, 3541],
      [4011, 3701, 3541],
    ]);
  });
});

const connectionTools = ['add_connection', 'reconnect_connection'];

const calledWhereListed: ReadonlySet<string> = new Set(['get_guide', 'list_models', ...connectionTools]);

const fieldsNamed: ReadonlySet<string> = new Set(['input_schema']);

function toolsNamedIn(text: string): readonly string[] {
  return [
    ...new Set(text.replaceAll(/`[^`]*`/gu, '').match(/\b(?:[a-z]+(?:_[a-z]+)+|search|introspect|validate)\b/gu)),
  ].filter((name) => !calledWhereListed.has(name) && !fieldsNamed.has(name));
}

describe('the tools a recipe calls', () => {
  it('are every tool its steps name, on a server with or without workflows, interaction functions, lookup functions and pages, but the guide tool, listed on every connection, list_models, add_connection and reconnect_connection, called only where they are listed, and the fields of a tool they name', () => {
    const { recipes } = served;
    const onEveryServer = [
      served,
      servedWithInteraction,
      servedWithEverything,
      servedForReasoningAndWorkflows,
      servedForReasoning,
      servedWithLookupAndPages,
    ].flatMap((shelf) => shelf.recipes);

    expect(onEveryServer.map(({ name, text }) => [name, toolsNamedIn(text).toSorted()])).toEqual(
      onEveryServer.map(({ name, calls }) => [name, calls.toSorted()]),
    );
    expect(recipes[0]?.text).toContain('list_models where this connection has it');
    expect(recipes.find(({ name }) => name === 'give-tools')?.text).toContain(
      'and search answers `providers`, call add_connection with the name of a provider there',
    );
  });
});

const notRunThere = ['computation', 'interaction', 'prediction'].map((type) => `${type} function`);

describe('the terminology guide of a server', () => {
  it('names only the types of definition the server runs', () => {
    const [terminology] = servedForReasoningAndWorkflows.guides;

    expect(terminology?.text).toContain('- Reasoning: Reasoning function.');
    expect(terminology?.text).toContain('- Coordination: Workflow.');
    expect(notRunThere.filter((type) => String(terminology?.text).toLowerCase().includes(type))).toEqual([]);
  });
});
