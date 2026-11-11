import { describe, expect, it } from 'vitest';

import { mostRecipeBytes } from '../index.ts';
import { byteLengthOf } from '../testing/guide-shelves.ts';
import { everySetOf, functionTypes, recipesServing, typesNamedIn, type Serving } from '../testing/served-types.ts';
import type { Recipe } from './guide-shelf.ts';

async function firstPlaybookServing(types: readonly string[], serving: Serving = {}): Promise<Recipe | undefined> {
  return (await recipesServing(types, serving)).find(({ name }) => name === 'first-playbook');
}

interface Served {
  readonly types: readonly string[];
  readonly text: string;
}

const firstPlaybookOfEveryType = [
  '# Create your first playbook',
  '',
  "A first playbook starts from the job the person wants done again and again. Break the job into its parts, give each part a function of the type its work needs, and write the workflow that runs the parts in order. Read a type's guide with get_guide before you write a function of that type, and the workflow guide before you write the workflow. Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document as the page guide says. When you create or run something, the response includes `studio`, a link to its page in Studio. Give that link to the person. A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.",
  '',
  '1. Call list_playbooks, and list_models where this connection has it to see the models this server can call. When it lists none and says in `provider_setup` how the person adds a model provider, help them do that first.',
  '2. Ask the person what the playbook is for, in their own words, and the first job it should do again and again: what it is given or must find, what it must work out, who must decide or be told, and the result they want from it. Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning", "continuously" or "whenever one arrives", take that as the answer and say so rather than asking again. When more than one model is offered, ask which to use; a model whose id ends in `*` stands for many and is not a model to run. Where a person must approve or decide, ask once where they want to be asked. It can be through a connection that sends them a request and reads their reply, such as a chat, an email provider or a ticketing app, or through you (`deliver: agent`). A request saved with neither is refused, and the refusal names the connections that can send it and read the reply. Ask once, too, where a notice goes: a channel or their direct messages.',
  '3. Say the job back to the person as its parts, in the order they happen, and give each part its type by what the part does, not by how it is done:',
  '   - it interprets, judges or writes: a reasoning function',
  '   - it reads what a connected service holds, or what earlier runs of the playbook produced: a lookup function',
  '   - it asks a person and takes their answer, or has a service act: an interaction function',
  "   - it forecasts a quantity from the playbook's own history: a prediction function",
  '   - it calculates or transforms data exactly: a computation function',
  '   - it makes an image or audio: a generation function',
  '',
  '   The order of the parts, the branches, the waits and what happens when a part fails belong to the workflow, never to a prompt. Four shapes show the range. A job that only judges what the person gives is one reasoning function. A job that only calculates is one computation function. A job that reads, calculates and writes is a lookup function, a computation function and a reasoning function. A job that reads, judges, asks and then acts is a lookup function, a reasoning function and two interaction functions. Agree the parts and their types with the person before you write anything.',
  "4. Create the playbook with create_playbook, with the person's words on what it is for, or use the playbook they name when list_playbooks shows it.",
  "5. Write each function in the format of its type's guide, in the order the job uses them, each with its `page` in the same document. A reasoning function takes the facts it judges as its input, which the workflow hands it. For a part that reads from a service or acts on one, follow the give-tools recipe. It makes a read a lookup function and an act an interaction function. A reasoning function names tools in `tools` only where its model must choose among them. Where that service is not connected yet, connect it with the connect-a-service recipe. Or build without it for now, so that the person sees a run today. Let the workflow take what a part would read as its input, pasted by the person. Ask a person through you (`deliver: agent`). Leave a part that has a service act, or sends a notice, until its service is connected, and tell the person it is not built yet. Show the person the documents and ask whether to save them.",
  '6. Once they agree, save each with create_definition, with its `type`. A function needs `diagram`: Mermaid source of how it works, or the word none. A workflow takes none. `overview` is optional: Markdown that tells the person what it does and why it is needed. A name that is taken is refused. Choose another with the person rather than change the function that has it.',
  '7. Test each function that can run now with run_definition on a made-up input, and tell the person what it answered, in their words. These need no connection: a reasoning function, a computation function and an interaction function held for you (`deliver: agent`). A test of an interaction function held for you (`deliver: agent`) waits for its answer. list_interactions shows the request, and answer_interaction answers it once the person says what to answer. A function that has a service act really acts when it runs. Run it only once the person agrees. A prediction function answers once the playbook has history.',
  "8. Read the workflow guide with get_guide and write the workflow that owns the job, whose steps call the functions in order and hand each one what the steps before it answered: one step is enough when that step finishes the job, and a later ask changes the workflow. Write its `page` in the same document: the outcome of each run as a headline with its key figures, and the main number of each period. Where the work starts on its own, give it a `schedule`, as the triggers guide says. A `schedule` holds its triggers: `cron` or `every` for set times, and `on` for what arrives. For set times, use `cron` with `time_zone` naming the person's time zone, or `every`. A run on a clock is given its due time alone. So its first steps are the lookup functions that find its material, or the workflow gives it a fixed input in `input.from`. For what arrives, use `on` with a filter on an event `type` named in the past tense, such as `com.example.item.received`. A run is then given a list holding the event, and the workflow passes the event's `data` to its first step. Where the material comes from sources not yet connected, start with `on`, so that the person starts runs today with material they paste, and move to a clock once lookup functions reach the sources.",
  "9. Show the person the workflow's document, and save it with create_definition, `type` workflow, once they agree.",
  "10. Run the workflow once, in one of two ways, never both. Where it starts `on` an event, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from and an `id` of its own, such as `test-1`. A real event's `source` and `id` would make that event a repeat, ignored when it comes. The event starts the run, so a moment later find it with list_runs, `type` workflow, and read it with get_run. Otherwise, start the run with run_definition. A step held for you (`deliver: agent`) waits for its answer, which you give with answer_interaction, as in a test. Tell the person what the run answered, in their words. Where the workflow starts on its own, tell them too when it next runs, in their own time, or what starts it.",
  '',
  "Then tell the person what they can do next: change when it runs with the schedule recipe and the triggers guide, or connect the services its parts still wait for, with the connect-a-service and give-tools recipes. Once it has more than one workflow, give the playbook a page with update_playbook, led by each workflow's main number.",
  '',
].join('\n');

const withEveryType = await firstPlaybookServing(functionTypes, { pages: true });

describe('the first-playbook recipe of a server that runs every type, workflows and pages', () => {
  it('starts from the job: its parts, a function of the type each part needs, and the workflow that runs them', () => {
    expect(withEveryType?.text).toBe(firstPlaybookOfEveryType);
  });

  it('is described by the job it builds, names no one format guide, and takes 8,001 of its 8,192 bytes', () => {
    expect(withEveryType).toMatchObject({
      title: 'Create your first playbook',
      description:
        'Creates a playbook from the job the person wants done again and again: a function of the right type for each part and the workflow that runs them, saved and run once the person has agreed.',
    });
    expect(withEveryType?.formatGuide).toBeUndefined();
    expect([byteLengthOf(firstPlaybookOfEveryType), mostRecipeBytes]).toEqual([8001, 8192]);
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

  it('gives the one type its line and its one shape, and says nothing of pages, of asking a person or of types it does not run', () => {
    expect(text).toContain(
      '   - it interprets, judges or writes: a reasoning function\n\n   The order of the parts, the branches, the waits and what happens when a part fails belong to the workflow, never to a prompt. A job that only judges what the person gives is one reasoning function. Agree the parts',
    );
    expect(text).toContain(
      ' Leave a part that has a service act, or sends a notice, until its service is connected, and tell the person it is not built yet.',
    );
    expect(text).toContain('A reasoning function needs no connection.');
    expect(text).not.toMatch(/`page`|page guide|deliver: agent|shapes show|update_playbook|lookup functions reach/u);
    expect(text).toContain('move to a clock once its functions reach the sources.');
  });
});

describe('the first-playbook recipe of a server that runs no workflow', () => {
  it('ends at the test of each function, and what comes next is the tools', async () => {
    const recipe = await firstPlaybookServing(['reasoning'], { workflows: false });

    expect(recipe?.text).toMatch(
      /\n7\. Test each function that can run now with run_definition on a made-up input, and tell the person what it answered, in their words\. A reasoning function needs no connection\. A function that has a service act really acts when it runs\. Run it only once the person agrees\.\n\nThen tell the person what they can do next: connect the services its parts still wait for, with the connect-a-service and give-tools recipes\.\n$/u,
    );
    expect(recipe?.text).toContain(
      'Or build without it for now, so that the person sees a run today. Leave a part that has a service act',
    );
    expect(recipe?.text).toContain('or the word none. `overview` is optional');
    expect(recipe?.calls).toEqual(['list_playbooks', 'create_playbook', 'create_definition', 'run_definition']);
  });

  it('without a reasoning function, lists no models, offers no tools and says nothing of what comes next', async () => {
    const recipe = await firstPlaybookServing(['computation'], { workflows: false });

    expect(recipe?.text).toContain('\n1. Call list_playbooks.\n');
    expect(recipe?.text).toContain('A computation function needs no connection.');
    expect(recipe?.text).not.toMatch(/give-tools|Then tell the person|model/u);
  });
});

describe('the first-playbook recipe of a server that runs lookup functions alone beside workflows', () => {
  it('finds the material of a run on a clock with lookup functions, and says no function runs at once', async () => {
    const text = String((await firstPlaybookServing(['lookup']))?.text);

    expect(text).toContain('So its first steps are the lookup functions that find its material, or the workflow');
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

  it('gives each function type it runs its line, by what a part of the job does', () => {
    expect(
      recipes.flatMap(({ types, text }: Served) =>
        types.filter((type) => !new RegExp(`\\n   - it [^\\n]*: an? ${type} function\\n`, 'u').test(text)),
      ),
    ).toEqual([]);
  });

  it('stays within the bound of a recipe', () => {
    expect(recipes.filter(({ text }: Served) => byteLengthOf(text) > mostRecipeBytes)).toEqual([]);
  });

  it('is not offered on a server that runs no function', async () => {
    expect((await recipesServing([])).map(({ name }) => name)).toEqual(['connect-a-service', 'schedule']);
  });
});
