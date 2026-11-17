import { describe, expect, it } from 'vitest';

import { mostRecipeBytes } from '../index.ts';
import { byteLengthOf } from '../testing/guide-shelves.ts';
import { everySetOf, functionTypes, recipesServing, type Serving, typesNamedIn } from '../testing/served-types.ts';
import { goalsGuideIn } from './goals-guide-renditions.ts';
import type { Recipe } from './guide-shelf.ts';

const marked = [
  '# Goals',
  '',
  'Learn what it should achieve.',
  '',
  '<!-- with messages -->',
  '',
  'Ask what to tell them, and where.',
  '',
  '<!-- end -->',
  '',
  '<!-- without messages -->',
  '',
  'Ask nothing about being told.',
  '',
  '<!-- end -->',
  '',
  '```',
  '- id: orders',
  '<!-- with messages -->',
  '  notify:',
  '    passed: now',
  '<!-- end -->',
  '  retired: false',
  '```',
  '',
  'The end.',
  '',
].join('\n');

describe('the goals guide in its two renditions', () => {
  it('keeps the lines of messages and drops the others where messages are on, each marker gone with the blank line after it', () => {
    expect(goalsGuideIn(marked, { messages: true })).toBe(
      [
        '# Goals',
        '',
        'Learn what it should achieve.',
        '',
        'Ask what to tell them, and where.',
        '',
        '```',
        '- id: orders',
        '  notify:',
        '    passed: now',
        '  retired: false',
        '```',
        '',
        'The end.',
        '',
      ].join('\n'),
    );
  });

  it('keeps the lines without messages and drops the others where messages are off, leaving single blank lines', () => {
    expect(goalsGuideIn(marked, { messages: false })).toBe(
      [
        '# Goals',
        '',
        'Learn what it should achieve.',
        '',
        'Ask nothing about being told.',
        '',
        '```',
        '- id: orders',
        '  retired: false',
        '```',
        '',
        'The end.',
        '',
      ].join('\n'),
    );
  });
});

describe('the marked text of the goals guide', () => {
  it('leaves a text with no markers as it is', () => {
    expect(goalsGuideIn('# Goals\n\nNo blocks.\n', { messages: false })).toBe('# Goals\n\nNo blocks.\n');
  });

  it('refuses a block opened inside another, an end with no block, and a block never ended, naming the line', () => {
    expect(() =>
      goalsGuideIn('<!-- with messages -->\n<!-- without messages -->\n<!-- end -->\n', { messages: true }),
    ).toThrow('The goals guide opens a block on line 2 inside the block opened on line 1');
    expect(() => goalsGuideIn('Text\n<!-- end -->\n', { messages: true })).toThrow(
      'The goals guide ends a block on line 2 that was never opened',
    );
    expect(() => goalsGuideIn('<!-- without messages -->\nText\n', { messages: false })).toThrow(
      'The goals guide opens a block on line 1 and never ends it',
    );
  });
});

async function firstPlaybookServing(types: readonly string[], serving: Serving = {}): Promise<Recipe | undefined> {
  return (await recipesServing(types, serving)).find(({ name }) => name === 'first-playbook');
}

interface Served {
  readonly types: readonly string[];
  readonly text: string;
}

const withEveryType = await firstPlaybookServing(functionTypes, { pages: true });

describe('the first-playbook recipe of a server that runs every type, workflows and pages', () => {
  it('names no one format guide', () => {
    expect(withEveryType?.formatGuide).toBeUndefined();
  });

  it('calls the tools of the playbook, its functions, its workflow and its page', () => {
    expect(withEveryType?.calls).toEqual([
      'list_playbooks',
      'create_playbook',
      'create_definition',
      'run_definition',
      'publish_event',
      'list_runs',
      'get_run',
      'update_playbook',
      'list_interactions',
      'answer_interaction',
    ]);
  });
});

const ofReasoningAndWorkflows = String((await firstPlaybookServing(['reasoning']))?.text);

describe('the first-playbook recipe of a server that runs reasoning functions and workflows alone', () => {
  const text = ofReasoningAndWorkflows;

  it('gives the one type its one shape, sends the agent to the list of types in the start guide, and says nothing of pages, of asking a person or of types it does not run', () => {
    expect(text).not.toMatch(
      /`page`|page guide|deliver: agent|shapes show|update_playbook|lookup functions reach|\n   - it /u,
    );
  });
});

describe('the first-playbook recipe of a server that runs no workflow', () => {
  it('ends at the test of each function, and what comes next is the tools', async () => {
    const recipe = await firstPlaybookServing(['reasoning'], { workflows: false });

    expect(recipe?.text).toMatch(/\n7\. /u);
    expect(recipe?.text).not.toMatch(/\n8\. |workflow guide/u);
    expect(recipe?.calls).toEqual(['list_playbooks', 'create_playbook', 'create_definition', 'run_definition']);
  });

  it('without a reasoning function, lists no models, offers no tools and says nothing of what comes next', async () => {
    const recipe = await firstPlaybookServing(['computation'], { workflows: false });

    expect(recipe?.text).not.toMatch(/give-tools|Then tell the person|model/u);
  });
});

describe('the first-playbook recipe of a server that runs lookup functions alone beside workflows', () => {
  it('says nothing of functions that need no connection, or of shapes it does not run', async () => {
    const text = String((await firstPlaybookServing(['lookup']))?.text);

    expect(text).not.toMatch(/no connection|shapes|one reasoning function/u);
  });
});

const servedSets = everySetOf(functionTypes).filter((types) => types.length > 0);
const recipes = await Promise.all(
  servedSets.flatMap((types) =>
    [true, false].map(async (workflows) => ({
      types,
      text: String((await firstPlaybookServing(types, { workflows, pages: workflows }))?.text),
    })),
  ),
);

describe('the first-playbook recipe of a server, whichever types it runs', () => {
  it('names no function type the server does not run', () => {
    expect(
      recipes.flatMap(({ types, text }: Served) => typesNamedIn(text).filter((named) => !types.includes(named))),
    ).toEqual([]);
  });

  it('leaves the line of each function type to the start guide, and sends the agent to it for the type of each step or part', () => {
    expect(recipes.filter(({ text }: Served) => /\n {3}- it /u.test(text))).toEqual([]);
    expect(recipes.filter(({ text }: Served) => !text.includes("the start guide's Build from the job"))).toEqual([]);
  });

  it('stays within the bound of a recipe', () => {
    expect(recipes.filter(({ text }: Served) => byteLengthOf(text) > mostRecipeBytes)).toEqual([]);
  });

  it('is not offered on a server that runs no function', async () => {
    expect((await recipesServing([])).map(({ name }) => name)).toEqual(['connect-a-service', 'schedule']);
  });
});
