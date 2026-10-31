import { readFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
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
      '\n9. Run the workflow with run_definition and tell the person what it answered, in their words. Where it starts on its own, tell them too when it next runs, in their own time, or what starts it. For `on`, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from, and a moment later show what its run answered with list_runs, `type` workflow, and get_run.\n\nThen tell the person what they can do next: change when it runs with the schedule recipe and the workflow guide, give it tools with the give-tools recipe, or make the playbook remember its answers with the remember recipe.\n',
    );
  });

  it('calls publish_event, list_runs and get_run beside the tools of the function', () => {
    expect(withWorkflows?.calls).toEqual([...callsOfTheFunction, 'publish_event', 'list_runs', 'get_run']);
  });
});

describe('the first-playbook recipe where the interaction-function guide is carried too', () => {
  it('names an interaction function among what comes next, after the schedule recipe and the tools', () => {
    expect(withWorkflowsAndInteraction?.text).toContain(
      'Then tell the person what they can do next: change when it runs with the schedule recipe and the workflow guide, give it tools with the give-tools recipe, ask someone through a connection and take their answer with an interaction function, or make the playbook remember its answers with the remember recipe.\n',
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
});

describe('the first-playbook recipe where the workflow guide is not carried', () => {
  it('ends at the run of the function and what comes next, as its file has it, and calls only the tools of the function', () => {
    expect([withoutWorkflows?.text, withoutWorkflows?.calls]).toEqual([firstPlaybookFile, callsOfTheFunction]);
    expect(firstPlaybookFile).toContain(
      'tell the person what it answered, in their words.\n\nThen tell the person what they can do next: give it tools with the give-tools recipe, or make the playbook remember its answers with the remember recipe.\n',
    );
  });
});
