import type { GuideVariables } from '@on.auto/definitions';
import { changedOnlyByWhoeverRunsTheServer } from '@on.auto/phrasing';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { describe, expect, it } from 'vitest';

import { mostRecipeBytes } from '../index.ts';
import { byteLengthOf, guideFiles } from '../testing/guide-shelves.ts';
import { everySetOf, functionTypes, recipesServing, type Serving, typesNamedIn } from '../testing/served-types.ts';
import type { Recipe } from './guide-shelf.ts';
import { guideShelfFrom, type ServedType } from './served-guides.ts';

async function giveToolsServing(types: readonly string[], serving: Serving = {}): Promise<Recipe | undefined> {
  return (await recipesServing(types, serving)).find(({ name }) => name === 'give-tools');
}

interface Served {
  readonly types: readonly string[];
  readonly text: string;
}

const giveToolsOfEveryType = [
  '# Give the playbook tools',
  '',
  "A tool of a connected service is put to work by the function type its use needs, and the tool itself says which: search gives each tool a `mark`. A read by a tool marked reads, searching included, is a lookup function: one call and no model, whether its arguments come from the run's input or from an earlier step's answer. An act, by a tool marked acts or unmarked, is an interaction function, which calls it with `call`: it answers at once and spends no model call. A reasoning function names tools in `tools` only where its model must explore, meaning what it looks for next depends on what it just read; choosing what to look for, what to open or which hits to read is not exploring, as the start guide's Build from the job says. Read a type's guide with get_guide before you write a function of that type. Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Write it as its type's guide shows under Its page. Read the page guide for the playbook's own page, or a page that folds other events or sets charts side by side. A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.",
  '',
  '1. Call search to see the tool servers this playbook may use and their tools, each with its `mark`; when the person named a server, give its name as `server`, and give `terms`, a few words of what the person wants done, to find the tools that fit among many. Call introspect for the input_schema of a tool before writing its arguments.',
  "2. When no server is listed, or not the one the person wants, or search says a server's connection is `connection_broken`, follow the connect-a-service recipe: it connects the service, or reconnects it, and sets it up for what the playbook will do there; then call search again. When a server says it cannot be asked just now, tell the person why, in its words; whoever runs the server can look into it.",
  "3. To learn what a tool answers, call it yourself with the arguments its input_schema takes. The `read` of a lookup or interaction function points into the call's `answer`. A reasoning function's model reads the call's `text`. Never save a function only to see what a tool answers. Call a tool whose `mark` is reads with query_connection. A tool whose `mark` is acts or unmarked may change something, so call it with execute_connection, and only once the person agrees. When a function needs an id, such as a channel's, call the tool that lists them and take the id from its answer, confirming the choice with the person.",
  '4. Ask the person what the playbook should do with the tools, and give each use its function:',
  "   - a read by a tool marked reads: a lookup function, whose `call` names the `server` and the `tool`, with its arguments in `with`, written from its input. One lookup function for each read. Where an earlier step answers the arguments, such as the ids a listing gave, the workflow hands them on, one run for each in a `for`, as the workflow guide's A lookup for each item shows. Where choosing what to look for, what to open or which hits to read is a judgement, a reasoning function with no `tools` makes it, lookup functions read each choice, and a reasoning function judges what they read.",
  '   - an act on a system, or a read by a tool that is not marked reads: an interaction function that calls the tool with `call`, written from the answer execute_connection gave.',
  "   - a question to a person: an interaction function too. Ask once where they want to be asked, then name in `deliver` the connection's tool that sends the request and in `replies` the one that reads the replies, or write `deliver: agent`.",
  '   - exploring, where what the model looks for next depends on what it just read: a reasoning function whose `tools` name only those tools. Hand it as input what lookup functions can read, so that it calls a tool only to explore.',
  "5. Write each function in the format of its type's guide, with its `page` in the same document, show it to the person, and save it with create_definition, with its `type`, once they agree.",
  '6. Run each with run_definition. A function that has a service act really acts when it runs, so run it only once the person agrees. A run that called tools and did not succeed is not run again under its id, since a tool may have changed something: read what it called with list_playbook_events, given its `run_id`, and start a new run only if the person still wants one.',
  '7. Tell the person what each run did with the tools, and that a function can call only the tools it names.',
  '8. Then, with the workflow guide, write or change the workflow that owns the job the person wants done again, whose steps are the functions, with its `page` in the same document: each step is handed what the steps before it answered, and a read comes before the step that needs it. Save it once they agree, run it, and tell the person what it answered and what they can do next.',
  '',
].join('\n');

const withEveryType = await giveToolsServing(functionTypes, { pages: true });

describe('the give-tools recipe of a server that runs every type, workflows and pages', () => {
  it('gives each use of a tool its function, by the mark the tool declares, before any step writes one', () => {
    expect(withEveryType?.text).toBe(giveToolsOfEveryType);
    expect(byteLengthOf(giveToolsOfEveryType)).toBe(5085);
  });

  it('is described by what each use takes, names no one format guide, and calls the tools its steps name', () => {
    expect(withEveryType?.description).toBe(
      "Puts the tools of a connected service to work: a lookup function for a read, an interaction function for an act or a question, and a reasoning function's tools only where its model must explore.",
    );
    expect(withEveryType?.formatGuide).toBeUndefined();
    expect(withEveryType?.calls).toEqual([
      'search',
      'introspect',
      'query_connection',
      'execute_connection',
      'create_definition',
      'run_definition',
      'list_playbook_events',
    ]);
  });
});

const ofReasoningAlone = String((await giveToolsServing(['reasoning'], { workflows: false }))?.text);

describe('the give-tools recipe of a server that runs reasoning functions alone', () => {
  it('names the tools in a reasoning function, ends at what the runs did, and speaks of no type it does not run', () => {
    expect(ofReasoningAlone).toContain(
      'search gives each tool a `mark`. A reasoning function names in `tools` the tools its model may call while it runs. Read a type',
    );
    expect(ofReasoningAlone).toContain(
      "give each use its function:\n   - a choice among tools that the model must make while it runs: a reasoning function whose `tools` name only those tools.\n5. Write each function in the format of its type's guide, show it to the person",
    );
    expect(ofReasoningAlone).toMatch(/a function can call only the tools it names\.\n$/u);
  });
});

describe('the give-tools recipe of a server that runs lookup and interaction functions and no reasoning function', () => {
  it('sends a read to a lookup function and an act to an interaction function, and says nothing of a model', async () => {
    const text = String((await giveToolsServing(['lookup', 'interaction']))?.text);

    expect(text).toContain(
      "is a lookup function: one call and no model, whether its arguments come from the run's input or from an earlier step's answer. An act, by a tool marked acts or unmarked",
    );
    expect(text).not.toMatch(/reasoning|model provider/u);
  });
});

const recipes = await Promise.all(
  everySetOf(functionTypes).flatMap((types) =>
    [true, false].map(async (workflows) => ({
      types,
      text: String((await giveToolsServing(types, { workflows, pages: workflows }))?.text),
    })),
  ),
);

describe('the give-tools recipe of a server, whichever types it runs', () => {
  it('names no function type the server does not run', () => {
    expect(
      recipes.flatMap(({ types, text }: Served) => typesNamedIn(text).filter((named) => !types.includes(named))),
    ).toEqual([]);
  });

  it('stays within the bound of a recipe', () => {
    expect(recipes.filter(({ text }: Served) => byteLengthOf(text) > mostRecipeBytes)).toEqual([]);
  });

  it('is offered only where the server runs a function that calls a tool', async () => {
    expect([
      await giveToolsServing(['computation', 'prediction', 'generation']),
      (await giveToolsServing(['interaction']))?.name,
    ]).toEqual([undefined, 'give-tools']);
  });
});

interface WorkflowBounds {
  readonly mostSteps: number;
  readonly longestRunMinutes: number;
}

const defaultBounds: WorkflowBounds = { mostSteps: 50, longestRunMinutes: 10 };

function guideVariablesOf(bounds: WorkflowBounds): GuideVariables {
  return {
    'workflow.most_steps': { value: `${bounds.mostSteps} steps`, default: `${defaultBounds.mostSteps} steps` },
    'workflow.longest_run': {
      value: `${bounds.longestRunMinutes} minutes`,
      default: `${defaultBounds.longestRunMinutes} minutes`,
    },
    'workflow.bounds_changed_by': {
      value: changedOnlyByWhoeverRunsTheServer,
      default: changedOnlyByWhoeverRunsTheServer,
    },
  };
}

function workflowsHeldTo(bounds: WorkflowBounds | undefined): ServedType {
  return {
    type: 'workflow',
    noun: { one: 'workflow', other: 'workflows' },
    guide: bounds === undefined ? { name: 'workflow' } : { name: 'workflow', variables: guideVariablesOf(bounds) },
  };
}

function withValues(text: string): string {
  return text
    .replace(
      'through steps.',
      'through steps, at most <span data-variable="workflow.most_steps">50 steps</span> of them.',
    )
    .replace(
      '## Document fields',
      [
        '<div data-variable="workflow.longest_run">',
        '',
        '```yaml',
        'timeout: 10 minutes',
        '```',
        '',
        '</div>',
        '',
        '## Document fields',
      ].join('\n'),
    );
}

function withTheTemplatesValue(text: string): string {
  return text.replace(
    /^# .*$/mu,
    (title) => `${title}\n\nA template renders within <span data-variable="templates.longest">2 seconds</span>.`,
  );
}

const files: ShippedFiles = {
  text: (file) =>
    guideFiles.text(file).then((text) => {
      if (file.path === 'docs/reference/workflow-format.md') {
        return withValues(text);
      }
      return file.path === 'docs/reference/template.md' ? withTheTemplatesValue(text) : text;
    }),
  bytes: (file) => guideFiles.bytes(file),
  list: (folder) => guideFiles.list(folder),
};

const templatesValue: GuideVariables = { 'templates.longest': { value: '5 seconds', default: '2 seconds' } };

function servedTo(bounds: WorkflowBounds | undefined, variables: GuideVariables): ReturnType<typeof guideShelfFrom> {
  return guideShelfFrom(files, [workflowsHeldTo(bounds)], { pages: false, variables });
}

describe('the guide of a capability whose page names its values', () => {
  it('says each value as the bounds the capability was given have it, in a sentence and in its example', async () => {
    const asComposed = await servedTo(defaultBounds, templatesValue);
    const heldToOthers = await servedTo({ mostSteps: 200, longestRunMinutes: 45 }, templatesValue);

    expect(asComposed.named('workflow')?.text).toContain('through steps, at most 50 steps of them.');
    expect(asComposed.named('workflow')?.text).toContain('```yaml\ntimeout: 10 minutes\n```\n\n## Document fields');
    expect(heldToOthers.named('workflow')?.text).toContain('through steps, at most 200 steps of them.');
    expect(heldToOthers.named('workflow')?.text).toContain('```yaml\ntimeout: 45 minutes\n```\n\n## Document fields');
    expect(heldToOthers.named('workflow')?.text).not.toMatch(/data-variable|50 steps|10 minutes/u);
  });

  it("says a value the server gives for a page that is no capability's, as the server has it", async () => {
    const shelf = await servedTo(defaultBounds, templatesValue);

    expect(shelf.named('templates')?.text).toContain('A template renders within 5 seconds.');
  });
});

describe('the guides of a server whose pages name values', () => {
  it('cannot be built where a page names a value the server does not declare', async () => {
    await expect(servedTo(undefined, templatesValue)).rejects.toThrow(
      'The page reference/workflow-format.md cannot be served as a guide. The line "<div data-variable="workflow.longest_run">" names the value workflow.longest_run, which this server does not declare. The line "A workflow coordinates a playbook\'s functions through steps, at most <span data-…" names the value workflow.most_steps, which this server does not declare.',
    );
  });

  it('cannot be built where the server declares one value twice', async () => {
    await expect(
      servedTo(defaultBounds, {
        ...templatesValue,
        'workflow.most_steps': { value: '1 step', default: '50 steps' },
      }),
    ).rejects.toThrow('The value workflow.most_steps is declared more than once for the guides of the server');
  });
});
