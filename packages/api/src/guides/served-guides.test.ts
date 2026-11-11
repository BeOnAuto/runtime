import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { mostGuideBytes, mostRecipeBytes } from '../index.ts';
import {
  byteLengthOf,
  bytesOf,
  guideFiles,
  onThisServer,
  recipeTextsOf,
  served,
  servedForReasoning,
  servedForReasoningAndWorkflows,
  servedWithEverything,
  servedWithInteraction,
  servedWithLookupAndPages,
} from '../testing/guide-shelves.ts';
import { withLinksResolved } from './page-links.ts';
import { guideShelfFrom, type ServedType } from './served-guides.ts';
import { withoutSiteMarkup } from './site-markup.ts';

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
  triggers: 'reference/triggers.md',
  events: 'reference/events.md',
};

describe('the guides of a server that runs every type of definition', () => {
  const { definitionTypes, guides, recipes } = served;

  it('are start, the terminology, a guide per type in the order of the product whatever order the types are given in, the templates, the triggers, the events and the four recipes it carries the format guides of', () => {
    expect([...guides, ...recipes].map(({ name }) => name)).toEqual([
      'start',
      'terminology',
      ...Object.keys(pages),
      'first-playbook',
      'connect-a-service',
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

  it('give each type the whole public page of its format, and the templates, triggers and events guides the pages of templates, triggers and events, without the markup of the documentation site, their links resolved, and the reasoning page what this server offers', () => {
    const [reasoningGuide, ...otherGuides] = guides.slice(2);
    const [reasoningPage = '', ...otherPages] = Object.values(pages);

    expect(reasoningGuide?.text).toBe(
      `${withLinksResolved(withoutSiteMarkup(page(reasoningPage)), reasoningPage).trimEnd()}\n\n${onThisServer}\n`,
    );
    expect(otherGuides.map(({ text }) => text)).toEqual(
      otherPages.map((path) => withLinksResolved(withoutSiteMarkup(page(path)), path)),
    );
  });
});

const predictionType: ServedType = {
  type: 'prediction',
  noun: { one: 'prediction function', other: 'prediction functions' },
  guide: { name: 'prediction-function' },
};

describe('the triggers guide of a server', () => {
  it('is carried where workflows are served, and not where they are not', () => {
    expect([servedForReasoningAndWorkflows.named('triggers')?.title, servedForReasoning.named('triggers')]).toEqual([
      'Triggers',
      undefined,
    ]);
  });
});

async function eventsCarriedFor(types: readonly ServedType[], keepsPages: boolean): Promise<boolean> {
  return (await guideShelfFrom(guideFiles, types, { pages: keepsPages })).named('events') !== undefined;
}

describe('the events guide of a server', () => {
  it('is carried where a workflow, a prediction function or a page takes the events, and not where nothing does', async () => {
    expect([
      servedForReasoningAndWorkflows.named('events')?.title,
      await eventsCarriedFor([predictionType], false),
      await eventsCarriedFor([], true),
      await eventsCarriedFor([], false),
      servedForReasoning.named('events'),
    ]).toEqual(['Events', true, true, false, undefined]);
  });
});

describe('the titles and links of the guides of a server that runs every type of definition', () => {
  const { guides } = served;

  it('title each type guide and the templates as their pages are titled', () => {
    expect(guides.slice(2).map(({ title }) => title)).toEqual([
      'Reasoning function format',
      'Prediction function format',
      'Computation function format',
      'Workflow format',
      'Templates',
      'Triggers',
      'Events',
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

  it('stay under 64 KiB each, the guide of interaction functions among them, and each recipe under 8 KiB', () => {
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
    expect(guides.slice(2).map(({ description }) => description)).toEqual([
      'How reasoning functions are written: their document, fields, examples and bounds.',
      'How prediction functions are written: their document, fields, examples and bounds.',
      'How computation functions are written: their document, fields, examples and bounds.',
      'How workflows are written: their document, fields, examples and bounds.',
      'The filters a template may use, the same in every template of every definition.',
      'How a workflow starts on its own: the triggers of its schedule, on an event, at set times or every so often, and their limits.',
      "The playbook's events that a workflow's trigger, a page and a prediction function take, and how a filter names them.",
    ]);
  });
});

describe('the recipes of a server', () => {
  it('leave out a recipe whose format guide the server does not carry, and keep one that names none', () => {
    expect(servedForReasoningAndWorkflows.recipes.map(({ name }) => name)).toEqual([
      'first-playbook',
      'connect-a-service',
      'give-tools',
      'schedule',
    ]);
  });

  it('are connecting a service alone for a server that runs no type of definition', async () => {
    expect((await guideShelfFrom(guideFiles, [], { pages: false })).recipes.map(({ name }) => name)).toEqual([
      'connect-a-service',
    ]);
  });

  it('ask the person in their own words, filled into what the prompt asks for', () => {
    const asked = Object.fromEntries(served.recipes.map(({ name, request }) => [name, request]));

    expect([
      asked['first-playbook']?.({}),
      asked['connect-a-service']?.({ service: 'Slack' }),
      asked['give-tools']?.({}),
      asked['give-tools']?.({ server: 'slack' }),
      asked['schedule']?.({ workflow: 'daily-digest', when: 'every weekday at 9:00' }),
    ]).toEqual([
      'Create my first playbook.',
      'Connect Slack to Auto for my team, then tell me what it can do.',
      'Give the playbook tools.',
      'Give the playbook the tools of the tool server slack.',
      'Run the workflow daily-digest every weekday at 9:00.',
    ]);
  });
});

describe('the recipes that give a playbook tools', () => {
  it('call a tool to learn what it answers, and never save a function only to see what it answers, within the bound of a recipe', () => {
    const texts = recipeTextsOf(served);

    expect(String(texts['give-tools'])).toContain(
      "3. To learn what a tool answers, call it yourself with the arguments its input_schema takes and read its `text`: that is what a run of a function will get. Never save a function only to see what a tool answers. Call a tool whose `mark` is reads with query_connection. A tool whose `mark` is acts or unmarked may change something, so call it with execute_connection, and only once the person agrees. When a function needs an id, such as a channel's, call the tool that lists them and take the id from its answer, confirming the choice with the person.",
    );
    expect(String(texts['connect-a-service'])).toContain(
      'tell the person that whoever runs this server sets tool servers up in its settings file, `auto-runtime.yaml`, under `tool_servers`; the server reads them when it starts again, and nothing more can be done here until then.',
    );
    expect(String(texts['first-playbook'])).toContain(
      'For a part that reads from a service or acts on one, follow the give-tools recipe. Where that service is not connected yet, connect it with the connect-a-service recipe.',
    );
    expect([byteLengthOf(String(texts['give-tools'])), byteLengthOf(String(texts['first-playbook']))]).toEqual([
      3013, 5577,
    ]);
  });
});

describe('the recipes of a server that serves interaction functions', () => {
  it('send a message a person answers to an interaction function, words a server without them does not serve', () => {
    const texts = recipeTextsOf(servedWithInteraction);

    expect(texts['give-tools']).toContain(
      "4. Ask the person what the playbook should do with the tools, and give each use its function:\n   - an act on a system, or a read by a tool that is not marked reads: an interaction function that calls the tool with `call`, written from the answer execute_connection gave.\n   - a question to a person: an interaction function too. Ask once where they want to be asked, then name in `deliver` the connection's tool that sends the request and in `replies` the one that reads the replies, or write `deliver: agent`.\n",
    );
    expect(recipeTextsOf(served)['give-tools']).not.toContain('interaction');
    expect(texts['first-playbook']).toContain(
      '   - it asks a person and takes their answer, or has a service act: an interaction function\n',
    );
    expect(texts['first-playbook']).toContain('; ask a person through you, `deliver: agent`; and leave a part');
    expect([
      bytesOf(texts, 'first-playbook', 'give-tools', 'schedule'),
      bytesOf(recipeTextsOf(served), 'first-playbook', 'give-tools', 'schedule'),
    ]).toEqual([
      [6178, 3661, 3564],
      [5577, 3013, 3564],
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
      onEveryServer.map(({ name, calls }) => [name, calls.filter((call) => !calledWhereListed.has(call)).toSorted()]),
    );
    expect(recipes[0]?.text).toContain('list_models where this connection has it');
    expect(recipes.find(({ name }) => name === 'connect-a-service')?.text).toContain(
      'and search answers `providers`, call add_connection with the name of the provider that serves what the person wants',
    );
    expect(recipes.map(({ name, calls }) => [name, calls.filter((call) => connectionTools.includes(call))])).toEqual([
      ['first-playbook', []],
      ['connect-a-service', connectionTools],
      ['give-tools', []],
      ['schedule', []],
    ]);
  });
});

const notRunThere = ['computation', 'interaction', 'prediction'].map((type) => `${type} function`);

describe('the terminology guide of a server', () => {
  it('names only the types of definition the server runs', () => {
    const terminology = servedForReasoningAndWorkflows.named('terminology');

    expect(terminology?.text).toContain('- Reasoning: Reasoning function.');
    expect(terminology?.text).toContain('- Coordination: Workflow.');
    expect(notRunThere.filter((type) => String(terminology?.text).toLowerCase().includes(type))).toEqual([]);
  });
});
