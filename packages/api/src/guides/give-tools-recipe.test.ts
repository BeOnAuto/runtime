import { describe, expect, it } from 'vitest';

import { mostRecipeBytes } from '../index.ts';
import { byteLengthOf } from '../testing/guide-shelves.ts';
import { everySetOf, functionTypes, recipesServing, typesNamedIn, type Serving } from '../testing/served-types.ts';
import type { Recipe } from './guide-shelf.ts';

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
  "A tool of a connected service is put to work by the function type its use needs, and the tool itself says which: search gives each tool a `mark`. A read the job always makes, by a tool marked reads, is a lookup function: one call and no model. An act, by a tool marked acts or unmarked, is an interaction function, which calls it with `call`: it answers at once and spends no model call. A reasoning function names tools in `tools` only where its model must choose among them while it runs, because which to call, or how often, depends on what they answer. Read a type's guide with get_guide before you write a function of that type. Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document, as its format guide says under Its page. A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.",
  '',
  '1. Call search to see the tool servers this playbook may use and their tools, each with its `mark`; when the person named a server, give its name as `server`, and give `terms`, a few words of what the person wants done, to find the tools that fit among many. Call introspect for the input_schema of a tool before writing its arguments.',
  "2. When no server is listed, or not the one the person wants, or search says a server's connection is `connection_broken`, follow the connect-a-service recipe: it connects the service, or reconnects it, and sets it up for what the playbook will do there; then call search again. When a server says it cannot be asked just now, tell the person why, in its words; whoever runs the server can look into it.",
  "3. To learn what a tool answers, call it yourself with the arguments its input_schema takes and read its `text`: that is what a run of a function will get. Never save a function only to see what a tool answers. Call a tool whose `mark` is reads with query_connection. A tool whose `mark` is acts or unmarked may change something, so call it with execute_connection, and only once the person agrees. When a function needs an id, such as a channel's, call the tool that lists them and take the id from its answer, confirming the choice with the person.",
  '4. Ask the person what the playbook should do with the tools, and give each use its function:',
  "   - a read the job always makes, by a tool marked reads: a lookup function, whose `call` names the `server` and the `tool`, with its arguments in `with`, written from the run's input. One lookup function for each read.",
  '   - an act on a system, or a read by a tool that is not marked reads: an interaction function that calls the tool with `call`, written from the answer execute_connection gave.',
  "   - a question to a person: an interaction function too. Ask once where they want to be asked, then name in `deliver` the connection's tool that sends the request and in `replies` the one that reads the replies, or write `deliver: agent`.",
  '   - a choice among tools that the model must make while it runs: a reasoning function whose `tools` name only those tools. Hand it as input what lookup functions already read, so that it calls a tool only for what it could not be handed.',
  "5. Write each function in the format of its type's guide, with its `page` in the same document, show it to the person, and save it with create_definition, with its `type`, once they agree.",
  '6. Run each with run_definition. A function that has a service act really acts when it runs, so run it only once the person agrees. A run that called tools and did not succeed is not run again under its id, since a tool may have changed something: read what it called with list_playbook_events, given its `run_id`, and start a new run only if the person still wants one.',
  '7. Tell the person what each run did with the tools, and that a function can call only the tools it names.',
  '8. Then, with the workflow guide, write or change the workflow that owns the job the person wants done again, whose steps are the functions, with its `page` in the same document: the steps that read come first, and each later step is handed what the steps before it answered. Save it once they agree, run it, and tell the person what it answered and what they can do next.',
  '',
].join('\n');

const withEveryType = await giveToolsServing(functionTypes, { pages: true });

describe('the give-tools recipe of a server that runs every type, workflows and pages', () => {
  it('gives each use of a tool its function, by the mark the tool declares, before any step writes one', () => {
    expect(withEveryType?.text).toBe(giveToolsOfEveryType);
    expect(byteLengthOf(giveToolsOfEveryType)).toBe(4417);
  });

  it('is described by what each use takes, names no one format guide, and calls the tools its steps name', () => {
    expect(withEveryType?.description).toBe(
      "Puts the tools of a connected service to work: a lookup function for a read, an interaction function for an act or a question, and a reasoning function's tools only where its model must choose.",
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

    expect(text).toContain('is a lookup function: one call and no model. An act, by a tool marked acts or unmarked');
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
