import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { recipesCarrying } from '../testing/served-types.ts';
import type { Recipe } from './guide-shelf.ts';

async function recipeCarrying(name: string, ...carried: readonly string[]): Promise<Recipe | undefined> {
  return (await recipesCarrying(carried)).find((recipe) => recipe.name === name);
}

const modelSentence =
  ' A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.\n';

describe('the recipes whose function calls a model', () => {
  it('say so at the top, and point to the model settings of a server of their own', async () => {
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function');
    const firstPlaybook = await recipeCarrying('first-playbook', 'reasoning-function', 'workflow');

    expect(firstPlaybook?.text).toContain(`Give that link to the person.${modelSentence}`);
    expect(giveTools?.text).toContain(`before you write a function of that type.${modelSentence}`);
  });
});

const everyDocumentCarriesItsPage =
  'Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document as the page guide says.';

describe('the keep recipe', () => {
  it('says first that every function it writes carries its page, read in the page guide, where the page guide is carried', async () => {
    const withPages = await recipeCarrying('keep', 'lookup-function', 'page');
    const withoutPages = await recipeCarrying('keep', 'lookup-function');

    expect(withPages?.text).toContain(
      "its section Reading the playbook's own runs sets out `runs`. Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document as the page guide says.\n",
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
      'or write one in the format of the workflow guide. Its document carries its `page`, so the person sees what each run did while they were away: keep it, or write it in the same document, as the page guide says.\n2. ',
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
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function');

    expect(giveTools?.text).toContain(
      "2. When no server is listed, or not the one the person wants, or search says a server's connection is `connection_broken`, follow the connect-a-service recipe: it connects the service, or reconnects it, and sets it up for what the playbook will do there; then call search again.",
    );
  });

  it('ends, where the workflow guide is carried, with the workflow whose steps are the functions, the reads first, run and its answer told', async () => {
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function', 'workflow');

    expect(giveTools?.text).toMatch(
      /a function can call only the tools it names\.\n8\. Then, with the workflow guide, write or change the workflow that owns the job the person wants done again, whose steps are the functions: the steps that read come first, and each later step is handed what the steps before it answered\. Save it once they agree, run it, and tell the person what it answered and what they can do next\.\n$/u,
    );
  });

  it('writes each function and the workflow with its page in the same document, where the page guide is carried too', async () => {
    const giveTools = await recipeCarrying('give-tools', 'reasoning-function', 'workflow', 'page');

    expect(giveTools?.text).toContain(
      `before you write a function of that type. ${everyDocumentCarriesItsPage} A reasoning function needs`,
    );
    expect(giveTools?.text).toContain(
      "5. Write each function in the format of its type's guide, with its `page` in the same document, show it to the person",
    );
    expect(giveTools?.text).toContain('whose steps are the functions, with its `page` in the same document: the steps');
  });
});
