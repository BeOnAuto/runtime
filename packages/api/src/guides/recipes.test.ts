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

const callsOfTheFunction = [
  'list_playbooks',
  'create_playbook',
  'create_definition',
  'query_connection',
  'run_definition',
];

describe('the first-playbook recipe where the workflow guide is carried', () => {
  it('says that a first playbook holds the workflow whose step its function is, which does what the person asked', () => {
    expect(withWorkflows?.text).toContain(
      'A first playbook holds a first reasoning function that the person sees answer, and the workflow whose step it is, which does what the person asked. Read the reasoning-function guide',
    );
  });

  it('learns how the work starts after what the playbook is for, and takes words that already say so as the answer', () => {
    expect(withWorkflows?.text).toContain(
      'a budget and a measurable goal. Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning", "continuously" or "whenever a lead comes in", take that as the answer and say so rather than asking again. When more than one model is offered',
    );
  });

  it('tests the function, then writes the workflow whose step it is, with its trigger as the workflow guide says, and saves it once the person agrees', () => {
    expect(withWorkflows?.text).toContain(
      "6. Ask for an input, run the function with run_definition to test it, and tell the person what it answered, in their words.\n7. Read the workflow guide with get_guide and write the workflow whose step is the function, which does what the person asked: a one-step workflow is still a workflow, and a later ask changes it. Where the work starts on its own, give it a `schedule` as the guide says. For set times, `cron` with `time_zone` naming the person's time zone, or `every`: a run they start is given only its due time, so the function finds its material with its tools, or the workflow gives it a fixed input in `input.from`. For what arrives, `on` with a filter on an event `type` named in the past tense, such as `com.acme.lead.received`: a run is given a list holding the event, and the workflow passes the event's `data` to the function. Where the material comes from sources not yet connected, start with `on`, so that the person starts runs today with material they paste, and move to a clock once the function's tools reach the sources.\n8. Show the person the workflow's document, and save it with create_definition, `type` workflow, once they agree.\n",
    );
  });

  it('runs the workflow and tells the person what it answered and when it next runs or what starts it, publishes what they paste for an event under an id of its own, and names the schedule recipe and the workflow guide first of what comes next', () => {
    expect(withWorkflows?.text).toContain(
      "\n9. Run the workflow with run_definition and tell the person what it answered, in their words. Where it starts on its own, tell them too when it next runs, in their own time, or what starts it. For `on`, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from and an `id` of its own, such as `test-1`: a real event's `source` and `id` would make that event a repeat, ignored when it comes. A moment later, show what its run answered with list_runs, `type` workflow, and get_run.\n\nThen tell the person what they can do next: change when it runs with the schedule recipe and the workflow guide, or give it tools with the give-tools recipe.\n",
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

  it('asks once, after what the playbook is for and its model, where the person wants to be asked, and where a notice goes', () => {
    expect(withWorkflowsAndInteraction?.text).toContain(
      'is not a model to run. Where a person must approve or decide, ask once where they want to be asked: through a connection that can send them a request and read their reply, such as a chat, an email provider or a ticketing app, or through you, `deliver: agent`; a request saved with neither lists those that can. Ask once, too, where a notice goes: a channel or their direct messages.\n',
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

const everyDocumentCarriesItsPage =
  'Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document, as its format guide says under Its page.';

const theFunctionsPage =
  'and a prompt. Write its `page` in the same front matter: the judgement of each run in a sentence, and the outcomes over time. When it should use';

describe('the first-playbook recipe where the page guide is carried with the workflow guide', () => {
  it('says first that every function and workflow carries its page, read in the page guide and written in its document', () => {
    expect(withWorkflowsAndPages?.text).toContain(
      `before you write the function. ${everyDocumentCarriesItsPage} When you create or run something`,
    );
  });

  it("writes the page of the function and of the workflow with each document, saved in the same create_definition, and calls update_playbook for the playbook's own page alone", () => {
    expect(withWorkflowsAndPages?.text).toContain(theFunctionsPage);
    expect(withWorkflowsAndPages?.text).toContain(
      'and a later ask changes it. Write its `page` in the same document: the outcome of each run as a headline with its key figures, and the main number of each period. Where the work starts on its own',
    );
    expect(withWorkflowsAndPages?.calls).toEqual([
      ...callsOfTheFunction,
      'publish_event',
      'list_runs',
      'get_run',
      'update_playbook',
    ]);
    expect(withWorkflowsAndPages?.text).not.toMatch(/update_definition|minimal page|\n10\. /u);
  });

  it('gives the playbook a page of its own once it has more than one workflow, among what comes next, where pages and workflows are both served', () => {
    const playbooksPage =
      "give it tools with the give-tools recipe. Once it has more than one workflow, give the playbook a page with update_playbook, led by each workflow's main number.\n";

    expect(withWorkflowsAndPages?.text).toContain(playbooksPage);
    expect(
      [withWorkflows?.text, withPagesAlone?.text].filter((text) => String(text).includes('update_playbook')),
    ).toEqual([]);
    expect(withPagesAlone?.calls).toEqual(callsOfTheFunction);
  });

  it("writes the function's page where the workflow guide is not carried, and no workflow's, as there is then no workflow", () => {
    expect(withPagesAlone?.text).toContain(theFunctionsPage);
    expect(withPagesAlone?.text).not.toContain('the main number of each period');
    expect(withWorkflows?.text).not.toContain('page guide');
  });
});

describe('the keep recipe', () => {
  it('says first that every function it writes carries its page, read in the page guide, where the page guide is carried', async () => {
    const withPages = await recipeCarrying('keep', 'lookup-function', 'page');
    const withoutPages = await recipeCarrying('keep', 'lookup-function');

    expect(withPages?.text).toContain(
      "its section Reading the playbook's own runs sets out `runs`. Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document, as its format guide says under Its page.\n",
    );
    expect(withoutPages?.text).not.toContain('page');
  });

  it("keeps what the person wants kept as the output of a run, read back with a lookup of that definition's runs", async () => {
    const keep = await recipeCarrying('keep', 'lookup-function');

    expect(keep?.text).toContain(
      "What the person wants kept is the output of a run: each run that succeeds keeps its output in the playbook's history, and a lookup function reads it back from the runs of that definition.",
    );
    expect(keep?.text).toContain('4. Write a lookup function with `runs` in place of `call`');
  });

  it('asks the person in their own words where the lookup-function guide is carried, and is not offered otherwise', async () => {
    const keep = await recipeCarrying('keep', 'lookup-function');

    expect(keep?.request({ what: 'who approves a budget' })).toBe('Keep who approves a budget for later.');
    expect(await recipeCarrying('keep', 'reasoning-function', 'workflow', 'page')).toBeUndefined();
  });
});

describe('the schedule recipe', () => {
  it("keeps the workflow's page, or writes one in the document it saves, where the page guide is carried, and reads a run's headline", async () => {
    const withPages = await recipeCarrying('schedule', 'workflow', 'page');
    const withoutPages = await recipeCarrying('schedule', 'workflow');

    expect(withPages?.text).toContain(
      'or write one in the format of the workflow guide. Its document carries its `page`, so the person sees what each run did while they were away: keep it, or write it in the same document, as the workflow guide says under Its page.\n2. ',
    );
    expect(withPages?.text).toContain('and get_run for one run, whose headline says what it did.\n9. ');
    expect(withoutPages?.text).toContain('and get_run for one run.\n9. ');
    expect(withoutPages?.text).not.toContain('page');
  });
});

const scheduleFile = readFileSync(new URL('recipes/schedule.md', import.meta.url), 'utf8');

describe('the schedule recipe, on what a run on a clock is given', () => {
  it('finds what is new from its due time, and takes a stretch of its own by hand for a time it missed', () => {
    expect(scheduleFile).toContain(
      "4. A run on a clock is given its due time alone, so it finds what is new from that: what came since the time before, such as in the 30 minutes before `schedule.due` for `every: PT30M`. A time skipped while the run before still ran, or one whose run failed, is not run again, so give the workflow an input of its own too, such as `since` and `until`, with which the person runs it by hand for a stretch it missed, and let `input.from` take either: `'${ $data.schedule === undefined ? $data : ({ since: new Date(Date.parse($data.schedule.due) - 1800000).toISOString(), until: $data.schedule.due }) }'`. In a time zone, the stretch between two daily times is 23 or 25 hours on the nights the clocks change.\n",
    );
  });

  it('works out when it runs next from the trigger, every counting from the save that gave the trigger its present form', () => {
    expect(scheduleFile).toContain(
      "Auto does not list the times ahead, so work the next one out from the trigger. `every` counts from the save that gave the trigger its present form, the workflow's `created_at` where it has not changed since; a later save that leaves it as it is keeps its times.\n",
    );
  });
});

describe('the schedule recipe, on a workflow another one starts', () => {
  it('starts it from the end of a step by its run_succeeded and calldepth, or from what the other emits, once for each item of a loop', () => {
    expect(scheduleFile).toContain(
      "5. To start a workflow when a step of another one ends, give it `on` with a filter on that step's run: `type: run_succeeded`, a `subject` naming the function, such as `computation/work-out-order`, and `calldepth: 1`, which a run by hand does not carry. Or have the other workflow `emit` an event of a type of your own; in a `for`, it emits one for each item.\n",
    );
  });
});

describe('the schedule recipe, on a run an event started that did not succeed', () => {
  it("says the event is not tried again nor taken twice, finds such runs and their input, and finishes the work by hand with the event's data", async () => {
    const schedule = await recipeCarrying('schedule', 'workflow');

    expect(schedule?.text).toMatch(
      /\n9\. A run an event started that was rejected or failed is not started again, and the same event published again is a repeat, which records nothing\. list_runs with `status` rejected, or failed, finds such runs, and list_playbook_events given a run's `run_id` shows its input, the list holding the event\. To finish its work, run the workflow by hand with the event's `data`, which `input\.from` takes as it takes the event: `'\$\{ Array\.isArray\(\$data\) \? \$data\[0\]\.data : \$data \}'`\.\n$/u,
    );
    expect(schedule?.calls).toContain('list_playbook_events');
  });
});

describe('the give-tools recipe', () => {
  it('sends an agent to the connect-a-service recipe where no server offers the tools or a connection is broken', async () => {
    const recipes = await recipesFor(recipeFiles, guidesNamed(['reasoning-function']));

    expect(recipes.find(({ name }) => name === 'give-tools')?.text).toContain(
      "2. When no server is listed, or not the one the person wants, or search says a server's connection is `connection_broken`, follow the connect-a-service recipe: it connects the service, or reconnects it, and sets it up for what the playbook will do there; then call search again.",
    );
  });

  it('ends, where the workflow guide is carried, with the workflow whose steps are the functions, run and its answer told', async () => {
    const recipes = await recipesFor(recipeFiles, guidesNamed(['reasoning-function', 'workflow']));

    expect(recipes.find(({ name }) => name === 'give-tools')?.text).toMatch(
      /the function can call only the tools it names\.\n8\. Then, with the workflow guide, write or change the workflow whose steps are the functions, which does what the person asked; save it once they agree, run it, and tell the person what it answered and what they can do next\.\n$/u,
    );
  });

  it('writes each function and the workflow with its page in the same document, where the page guide is carried too', async () => {
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function', 'workflow', 'page');

    expect(giveTools?.text).toContain(
      `before you write one. ${everyDocumentCarriesItsPage} A reasoning function needs`,
    );
    expect(giveTools?.text).toContain(
      'in the format of the reasoning-function guide, with its `page` in the same document, show it to the person, and save it',
    );
    expect(giveTools?.text).toMatch(
      /which does what the person asked, with its `page` in the same document; save it once they agree, run it, and tell the person what it answered and what they can do next\.\n$/u,
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
