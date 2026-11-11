import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import {
  byteLengthOf,
  guideFiles,
  served,
  servedForReasoning,
  servedWithEverything,
  servedWithLookupAndPages,
} from '../testing/guide-shelves.ts';
import { definitionTypesOf, everySetOf, functionTypes, typesNamedIn } from '../testing/served-types.ts';
import type { GuideShelf } from './guide-shelf.ts';
import { guideShelfFrom } from './served-guides.ts';
import { startGuideName, startGuideOf } from './start-guide.ts';

function startOf(shelf: GuideShelf): string {
  return shelf.named(startGuideName)?.text ?? '';
}

const headings = (text: string): readonly string[] => text.split('\n').filter((line) => line.startsWith('## '));

const sectionOf = (text: string, heading: string): string =>
  text.split('\n## ').find((section) => section.startsWith(`${heading}\n`)) ?? '';

const whereToGo = (text: string): readonly string[] =>
  sectionOf(text, 'Where to go')
    .split('\n')
    .filter((line) => line.startsWith('- '));

describe('the guide start of a server that runs every type and keeps pages', () => {
  const text = startOf(servedWithEverything);

  it('is the first guide of the shelf, titled and described for a person or a client that lists it', () => {
    expect(servedWithEverything.guides[0]).toMatchObject({
      name: 'start',
      title: 'Start here',
      description:
        'Where an agent begins: what a playbook is made of, what a workflow owns, what the agent does itself, and which guide each task needs.',
    });
    expect(servedWithEverything.everyGuide.filter(({ name }) => name === 'start')).toHaveLength(1);
  });

  it('opens with what the server is and what the agent does, and says where to go for each task, the recipes it carries among them', () => {
    expect(text).toMatch(
      /^# Start here\n\nYou are the agent that builds a playbook with the person, tests what you built, and sets up what its runs act on; Auto Runtime runs the playbook, and Studio manages it\. This guide says which function type each part of a job takes, what a playbook is made of, what a workflow owns, what you do yourself, and which guide each task needs\.\n\n## Build from the job\n/u,
    );
    expect(whereToGo(text)).toEqual([
      '- What the words of a playbook mean: the guide terminology.',
      '- To build a playbook from nothing: the recipe first-playbook, which names the guides its steps need.',
      '- To write a function or a workflow: the guide of its type, one of reasoning-function, interaction-function, prediction-function, computation-function, and workflow. Each says how its document is written, with its examples and bounds, and how its page shows the person its results.',
      "- To connect a service and set it up for the playbook's runs: the recipe connect-a-service.",
      '- To put the tools of a connected service to work, as interaction functions: the recipe give-tools.',
      '- To start a workflow on its own, at set times or whenever an event arrives: the recipe schedule.',
      '- The filters a template may use: the guide templates. How a page is written: the guide page.',
      '- How a workflow starts on its own, by its triggers and their limits: the guide triggers.',
      "- What the playbook's events hold, and how a filter names them: the guide events.",
    ]);
    expect(text).toContain(
      '\n\nget_guide reads any of them, and its description names the recipes this connection can follow. A tool that cannot do what was asked says why and what to change.\n',
    );
  });

  it('says what a playbook is made of, how a reasoning function names its model and what a workflow does, and that every workflow and function takes a page', () => {
    expect(text).toContain(
      "## What a playbook is made of\n\nA playbook holds work that keeps running after a conversation, in any line of business: one responsibility, such as deciding each case that comes in or keeping a list of records ranked. It contains one brain, the collection of its reusable functions, and its workflows. Runs belong to the playbook.\n\nA reasoning function names a model that list_models lists. A workflow puts the playbook's functions to work in steps: it waits for input, it can start on a schedule or event, and run_definition runs it.\n\nEvery workflow and function takes a page that shows the person its results, run by run and over time.\n",
    );
  });

  it('teaches first that each part of the job takes a function of the type its work needs, a line for each type it runs, and what the workflow owns', () => {
    expect(sectionOf(text, 'Build from the job')).toBe(
      "Build from the job\n\nStart from the job the person wants done again and again, not from a function. Break the job into its parts and give each part a function of the type its work needs, by what the part does, not by how it is done:\n\n- it interprets, judges or writes: a reasoning function\n- it asks a person and takes their answer, or has a service act: an interaction function\n- it forecasts a quantity from the playbook's own history: a prediction function\n- it calculates or transforms data exactly: a computation function\n\nA workflow runs the parts in order and hands each one what the parts before it answered. The order, the branches, the waits and what happens when a part fails are the workflow's, never a prompt's. A job that is one judgement is one reasoning function, and one step is enough. These run at once, with nothing connected: a reasoning function, a computation function and an interaction function held for you (`deliver: agent`). An interaction function that goes through a service needs its connection. A prediction function needs the playbook's history.\n\nWhen you change a playbook that exists, keep to the same rule. Where a reasoning function has come to hold a calculation, a question or an act, give that part a function of its own type, and make it a step of the workflow. Do so once the person agrees, rather than write a longer prompt.\n",
    );
  });
});

describe('what the guide start of that server says of workflows, of the agent and of services', () => {
  const text = startOf(servedWithEverything);

  it('says that a workflow owns one job the business does again and again, and what is not a workflow', () => {
    expect(text).toContain(
      '## What a workflow owns\n\nA workflow owns one job the business does again and again, with a result the person recognizes as done: a list of records kept ranked, a case that came in decided and answered, a period that ended measured and reported. Before you write one, work out with the person what starts it, a time, an event or someone asking; what one run handles, an item, a case or a period; what done looks like; and which decisions stay with a person. One step is enough when that step finishes the job. Such a workflow is the job, not a wrapper: it is what runs that step again and again.\n',
    );
    expect(text).toContain(
      "The playbook's workflows, which list_definitions shows and Studio presents, are the person's list of jobs: read it back in their words, and keep off it anything that is not a job they want done again. These are not workflows:\n\n- A function the person wants to see answer, or that you want to test: run it with run_definition. A workflow made only to see a function answer is a wrapper, not a job.\n- A question to a person, and the wait for their answer: an interaction function. The workflow that needs the answer calls it as a step, and owns what comes before and after.\n- Work that several jobs share, such as scoring an item or reading a list of records: a function, which each workflow calls as a step.\n- A check of a service, its connection or its setup, a test, or a change to saved definitions: your own work, below.\n\nBefore you add a workflow, look for the one that owns the same job: a new source of input, a check inside the job or a handoff to a person usually belongs inside it.\n",
    );
  });

  it("says that testing, setting up and checking are the agent's own work, done with the tools, with the connections that takes", () => {
    expect(text).toContain(
      "## What you do yourself\n\nYou are the playbook's developer. Testing, setting up and checking are your work, done with the tools below, and none of it is saved as a workflow. Which tools a connection lists depends on where it acts and on what its caller may do. The caller's own org's connection lists every tool the caller may call. One that manages the org's playbooks lists the tools that manage playbooks and connections, not those that work inside a playbook. One that acts inside a playbook lists only those.\n\n- To learn what a tool answers, call it with query_connection; a tool that may change something, with execute_connection, once the person agrees; dry_run checks the arguments without calling. Never save a function only to see what a tool answers.\n- To test a function, run it with run_definition, and read its run with get_run and list_playbook_events. A run that called a tool may have changed something, so one that did not succeed is not run again under its id.\n- To set a service up for the playbook's runs, such as a team's statuses, a channel or a label, do it with the person before the first run, through the tools of the connection; the recipe connect-a-service sets out how. A run acts on what is there and sets nothing up.\n- Where setting up or testing takes tools or access the runs do not need, connect them: ask for the access with the connection, as `more` of add_connection, or add the service's own MCP server or HTTP API by hand, so that you do the work here rather than send the person into the service.\n- A check a run must make each time, such as that an item is still where the job expects it, is a step of the workflow that owns the job. A check made before the first run, or when something at the service changes, is yours.\n",
    );
  });

  it('says how a service is connected and set up, and how a person is asked, and ends there', () => {
    expect(text).toMatch(
      /## Connecting a service\n\nsearch finds the provider of a service by its words, and add_connection connects it to the org's playbooks; the person approves on the page it links\. Where no provider or server matches, add_connection can still take the service's own MCP server or HTTP API, given by hand; a service with neither cannot be connected\.\n\n## Asking a person\n\nWhere a person must approve or decide, ask once where they want to be asked: through a connection that sends them a request and reads their reply, such as a chat, an email provider or a ticketing app, or through you, `deliver: agent`\. An interaction function makes the request and waits; answer_interaction answers one held for an agent, once the person says what to answer; the interaction-function guide says how\.\n$/u,
    );
  });

  it('has its eight sections in that order, takes 7,670 bytes, and uses no term of the internal vocabulary', () => {
    expect(headings(text)).toEqual([
      '## Build from the job',
      '## Where to go',
      '## What a playbook is made of',
      '## What a workflow owns',
      '## What you do yourself',
      '## Connecting a service',
      '## Asking a person',
    ]);
    expect(byteLengthOf(text)).toBe(7670);
    expect(internalTermsIn(text)).toEqual([]);
  });
});

describe('the guide start of a server that runs lookup functions and keeps pages', () => {
  const text = startOf(servedWithLookupAndPages);

  it('names the recipe keep, and says what a lookup function is for and that one through a service needs its connection', () => {
    expect(whereToGo(text)).toContain('- To keep something for later, and read it back: the recipe keep.');
    expect(text).toContain(
      '- it reads what a connected service holds, or what earlier runs of the playbook produced: a lookup function\n',
    );
    expect(text).toContain(
      'A reasoning function runs at once, with nothing connected. A lookup function that reads a service needs its connection.\n\nWhen you change a playbook that exists, keep to the same rule. Where a reasoning function has come to hold a read, give that part',
    );
    expect(text).toContain(
      "Runs belong to the playbook.\n\nWhat the person wants kept is the output of a run, read back with a lookup of that definition's runs. A reasoning function names a model",
    );
  });
});

describe('the guide start of a server that runs neither interaction functions nor pages', () => {
  const text = startOf(served);

  it('says nothing of asking a person, of pages or of the recipe keep', () => {
    expect(text).not.toMatch(/interaction function|takes a page|the guide page|the recipe keep|Asking a person/u);
    expect(headings(text)).not.toContain('## Asking a person');
    expect(whereToGo(text)).toHaveLength(9);
  });
});

describe('the guide start of a server that runs reasoning functions alone', () => {
  const text = startOf(servedForReasoning);

  it('says nothing of what a workflow owns, of the recipe schedule, of the events or of the types it does not run', () => {
    expect(headings(text)).toEqual([
      '## Build from the job',
      '## Where to go',
      '## What a playbook is made of',
      '## What you do yourself',
      '## Connecting a service',
    ]);
    expect(text).toContain('- To write a function: the guide of its type, reasoning-function. Each says how');
    expect(text).toContain(
      '\n\n- it interprets, judges or writes: a reasoning function\n\nA job that is one judgement is one reasoning function. A reasoning function runs at once, with nothing connected.\n\n## Where to go\n',
    );
    expect(text).toContain('\n\nA reasoning function names a model that list_models lists.\n');
    expect(text).not.toMatch(/schedule|computation|prediction|lookup|the guide events/u);
  });
});

describe('the guide start of a server that runs no type of definition', () => {
  it('sends the agent to the terminology, the recipe connect-a-service and the templates, and names no function type', async () => {
    const text = startOf(await guideShelfFrom(guideFiles, [], { pages: false }));

    expect(whereToGo(text)).toEqual([
      '- What the words of a playbook mean: the guide terminology.',
      "- To connect a service and set it up for the playbook's runs: the recipe connect-a-service.",
      '- The filters a template may use: the guide templates.',
    ]);
    expect(text).not.toMatch(/Build from the job|which function type/u);
    expect(headings(text)).toEqual([
      '## Where to go',
      '## What a playbook is made of',
      '## What you do yourself',
      '## Connecting a service',
    ]);
  });

  it('is built from the types, the pages, the events and the recipes it is given, and nothing is read from a page', () => {
    const built = startGuideOf({ definitionTypes: [], pages: true, events: true, recipes: [] });

    expect(built.name).toBe('start');
    expect(whereToGo(built.text)).toEqual([
      '- What the words of a playbook mean: the guide terminology.',
      '- The filters a template may use: the guide templates. How a page is written: the guide page.',
      "- What the playbook's events hold, and how a filter names them: the guide events.",
    ]);
  });
});

interface Started {
  readonly types: readonly string[];
  readonly text: string;
}

describe('the guide start of a server, whichever types it runs', () => {
  const starts = everySetOf(functionTypes).flatMap((types) =>
    [true, false].map((workflows) => ({
      types,
      text: startGuideOf({
        definitionTypes: definitionTypesOf(types, workflows),
        pages: workflows,
        events: workflows,
        recipes: ['first-playbook', 'connect-a-service', 'give-tools', 'schedule', 'keep'],
      }).text,
    })),
  );

  it('names no function type the server does not run', () => {
    expect(
      starts.flatMap(({ types, text }: Started) => typesNamedIn(text).filter((named) => !types.includes(named))),
    ).toEqual([]);
  });

  it('gives each function type it runs its line, by what a part of the job does', () => {
    expect(
      starts.flatMap(({ types, text }: Started) =>
        types.filter((type) => !new RegExp(`\\n- it [^\\n]*: an? ${type} function\\n`, 'u').test(text)),
      ),
    ).toEqual([]);
  });

  it('says of a server that runs only generation functions which type each part takes, and nothing of when parts run', () => {
    const text = startGuideOf({
      definitionTypes: definitionTypesOf(['generation'], false),
      pages: false,
      events: false,
      recipes: [],
    }).text;

    expect(sectionOf(text, 'Build from the job')).toMatch(/: a generation function\n$/u);
  });
});
