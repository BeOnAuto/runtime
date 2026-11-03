import { readFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { describe, expect, it } from 'vitest';

import { apiShippedRoots } from '../index.ts';
import type { Guide, Recipe } from './guide-shelf.ts';
import { recipesFor } from './recipes.ts';

const recipeFiles = shippedFilesOnDisk(apiShippedRoots());

function guidesNamed(names: readonly string[]): readonly Guide[] {
  return names.map((name) => ({ name, title: name, description: name, text: `# ${name}\n` }));
}

async function firstPlaybookCarrying(...carried: readonly string[]): Promise<Recipe | undefined> {
  const recipes = await recipesFor(recipeFiles, guidesNamed(['reasoning-function', ...carried]));
  return recipes.find(({ name }) => name === 'first-playbook');
}

const withWorkflows = await firstPlaybookCarrying('workflow');

const withWorkflowsAndInteraction = await firstPlaybookCarrying('workflow', 'interaction-function');

const withoutWorkflows = await firstPlaybookCarrying();

const withWorkflowsAndPages = await firstPlaybookCarrying('workflow', 'page');

const withPagesAlone = await firstPlaybookCarrying('page');

async function recipeCarrying(name: string, ...carried: readonly string[]): Promise<Recipe | undefined> {
  const recipes = await recipesFor(recipeFiles, guidesNamed(carried));
  return recipes.find((recipe) => recipe.name === name);
}

const modelSentence =
  ' A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.\n';

const firstPlaybookFile = readFileSync(new URL('recipes/first-playbook.md', import.meta.url), 'utf8');

const callsOfTheFunction = ['list_playbooks', 'create_playbook', 'create_definition', 'execute', 'run_definition'];

describe('the first-playbook recipe where the workflow guide is carried', () => {
  it('says that a first playbook holds the workflow whose step its function is, which does what the person asked', () => {
    expect(withWorkflows?.text).toContain(
      'A first playbook holds a first reasoning function that the person sees answer, and the workflow whose step it is, which does what the person asked. Read the reasoning-function guide',
    );
  });

  it('learns how the work starts after what the playbook is for, and takes words that already say so as the answer', () => {
    expect(withWorkflows?.text).toContain(
      'a budget and a measurable goal. Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning", "continuously", "keep reviewing" or "whenever a lead comes in", take that as the answer and say so rather than asking again. When more than one model is offered',
    );
  });

  it('tests the function, then writes the workflow whose step it is, with its trigger as the workflow guide says, and saves it once the person agrees', () => {
    expect(withWorkflows?.text).toContain(
      "6. Ask for an input, run the function with run_definition to test it, and tell the person what it answered, in their words.\n7. Read the workflow guide with get_guide and write the workflow whose step is the function, which does what the person asked: a one-step workflow is still a workflow, and a later ask changes it. Where the work starts on its own, give it a `schedule` as the guide says. For set times, `cron` with `time_zone` naming the person's time zone, or `every`: a run they start is given only its due time, so the function finds its material with its tools, or the workflow gives it a fixed input in `input.from`. For what arrives, `on` with a filter on an event `type` named in the past tense, such as `com.acme.lead.received`: a run is given a list holding the event, and the workflow passes the event's `data` to the function. Where the material comes from sources not yet connected, start with `on`, so that the person starts runs today with material they paste, and move to a clock once the function's tools reach the sources.\n8. Show the person the workflow's document, and save it with create_definition, `type` workflow, once they agree.\n",
    );
  });

  it('runs the workflow and tells the person what it answered and when it next runs or what starts it, publishes what they paste for an event, and names the schedule recipe and the workflow guide first of what comes next', () => {
    expect(withWorkflows?.text).toContain(
      '\n9. Run the workflow with run_definition and tell the person what it answered, in their words. Where it starts on its own, tell them too when it next runs, in their own time, or what starts it. For `on`, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from, and a moment later show what its run answered with list_runs, `type` workflow, and get_run.\n\nThen tell the person what they can do next: change when it runs with the schedule recipe and the workflow guide, or give it tools with the give-tools recipe.\n',
    );
  });

  it('calls publish_event, list_runs and get_run beside the tools of the function', () => {
    expect(withWorkflows?.calls).toEqual([...callsOfTheFunction, 'publish_event', 'list_runs', 'get_run']);
  });
});

describe('the first-playbook recipe where the interaction-function guide is carried too', () => {
  it('names an interaction function among what comes next, after the schedule recipe and the tools', () => {
    expect(withWorkflowsAndInteraction?.text).toContain(
      'Then tell the person what they can do next: change when it runs with the schedule recipe and the workflow guide, or give it tools with the give-tools recipe. They can also ask someone through a connection and take their answer with an interaction function.\n',
    );
    expect(withWorkflowsAndInteraction?.calls).toEqual(withWorkflows?.calls);
  });

  it('asks once, after what the playbook is for and its model, where the person wants to be asked', () => {
    expect(withWorkflowsAndInteraction?.text).toContain(
      'is not a model to run. Where a person must approve or decide, ask once where they want to be asked: through a connection that can send them a request and read their reply, such as a chat, an email provider or a ticketing app, or through you, `deliver: agent`; a request saved with neither lists those that can.\n',
    );
    expect(withWorkflows?.text).not.toContain('ask once where they want to be asked');
  });
});

describe('the recipes whose function calls a model', () => {
  it('say so at the top, and point to the model settings of a server of their own', async () => {
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function');

    expect(firstPlaybookFile).toContain(`Give that link to the person.${modelSentence}`);
    expect(giveTools?.text).toContain(`before you write one.${modelSentence}`);
  });
});

describe('the first-playbook recipe where the page guide is carried with the workflow guide', () => {
  it('gives the workflow its page after its run, from the minimal page of the page guide, and shows the person its headline', () => {
    expect(withWorkflowsAndPages?.text).toContain(
      "and get_run.\n10. Read the page guide with get_guide and give the workflow its page, which shows the person what each run did and the runs so far: start from the guide's minimal page, a headline for each run and one chart, keyed by the period a run is about where its output carries one. Show the person the page, add it to the workflow's document as its `page` and save that with update_definition once they agree, and show them the run's headline with get_run.\n\nThen tell the person",
    );
    expect(withWorkflowsAndPages?.calls.filter((name) => name !== 'update_definition')).toEqual(withWorkflows?.calls);
    expect(withWorkflowsAndPages?.calls).toContain('update_definition');
  });

  it('gives no page where the workflow guide is not carried, since there is then no workflow to present', () => {
    expect(withPagesAlone?.text).toBe(firstPlaybookFile);
    expect(withWorkflows?.text).not.toContain('page guide');
  });
});

describe('the schedule recipe', () => {
  it('ends, where the page guide is carried, with a page for a workflow that has none, so the person sees its runs', async () => {
    const withPages = await recipeCarrying('schedule', 'workflow', 'page');
    const withoutPages = await recipeCarrying('schedule', 'workflow');

    expect(withPages?.text).toMatch(
      /and get_run for one run\.\n7\. Where the workflow has no page yet, give it one with the page guide, so the person sees what each run did while they were away: a headline for each run and one chart of the runs so far, from the guide's minimal page, keyed by the period a run is about where its output carries one\. Add it to the workflow's document as its `page` and save that with update_definition once they agree\.\n$/u,
    );
    expect(withoutPages?.text).toMatch(/and get_run for one run\.\n$/u);
  });
});

describe('the give-tools recipe', () => {
  it('sends an agent to reconnect_connection where search says a connection is broken and its words say to reconnect it', async () => {
    const recipes = await recipesFor(recipeFiles, guidesNamed(['reasoning-function']));

    expect(recipes.find(({ name }) => name === 'give-tools')?.text).toContain(
      "Where search says a server's connection is `connection_broken` and its words say to reconnect it, call reconnect_connection with its `connection` as `id` and give the person the link it answers, rather than removing the connection and adding it again.",
    );
  });

  it('ends, where the workflow guide is carried, with the workflow whose steps are the functions, run and its answer told', async () => {
    const recipes = await recipesFor(recipeFiles, guidesNamed(['reasoning-function', 'workflow']));

    expect(recipes.find(({ name }) => name === 'give-tools')?.text).toMatch(
      /the function can call only the tools it names\.\n9\. Then, with the workflow guide, write or change the workflow whose steps are the functions, which does what the person asked; save it once they agree, run it, and tell the person what it answered and what they can do next\.\n$/u,
    );
  });

  it('gives the workflow a page where it has none, where the page guide is carried too', async () => {
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function', 'workflow', 'page');

    expect(giveTools?.text).toMatch(
      /and tell the person what it answered and what they can do next\. Where the workflow has no page yet, give it one with the page guide, from its minimal page: a headline for each run and one chart of the runs so far\.\n$/u,
    );
  });
});

describe('the first-playbook recipe where the workflow guide is not carried', () => {
  it('ends at the run of the function and what comes next, as its file has it, and calls only the tools of the function', () => {
    expect([withoutWorkflows?.text, withoutWorkflows?.calls]).toEqual([firstPlaybookFile, callsOfTheFunction]);
    expect(firstPlaybookFile).toContain(
      'tell the person what it answered, in their words.\n\nThen tell the person what they can do next: give it tools with the give-tools recipe.\n',
    );
  });
});

describe('the remember recipe', () => {
  it('asks the person in their own words where the format guide it names is carried', async () => {
    const recipes = await recipesFor(recipeFiles, guidesNamed(['memory-function']));
    const remember = recipes.find(({ name }) => name === 'remember');

    expect(remember?.request({ what: 'what it posted today' })).toBe(
      'Make the playbook remember what it posted today.',
    );
  });
});
