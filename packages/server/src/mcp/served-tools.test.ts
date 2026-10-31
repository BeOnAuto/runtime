import { readFileSync } from 'node:fs';

import { listedTools, withMcpSession, type ListedTool, type McpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let tools: readonly ListedTool[];

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

beforeAll(async () => {
  server = await servingReasoning([]);
  tools = await onMcp(async (session) => listedTools(await session.listTools()));
});

afterAll(async () => {
  await server.stop();
});

const addressedToTheAgent = [
  /\bMUST\b/u,
  /\balways\b/iu,
  /\byou\b/iu,
  /(?:^|[.;:]\s+)(?:first|then|never)\b/iu,
  /\b(?:first|then)\s+(?:call|use|run|read|ask|check|create|list|get|give|tell|poll)\b/iu,
  /\b(?:call|use|run|read)\s+\S+\s+first\b/iu,
];

const formatGuides = [
  'reasoning-function',
  'interaction-function',
  'computation-function',
  'recall-function',
  'prediction-function',
  'workflow',
];

const listingEveryFormat: unknown = expect.arrayContaining(formatGuides);

const anyJsonValue: ReadonlySet<string> = new Set(['input', 'answer']);

const PropertiesSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
});

const propertiesOf = Schema.decodeUnknownSync(PropertiesSchema);

interface Argument {
  readonly where: string;
  readonly name: string;
  readonly keywords: readonly string[];
  readonly description: unknown;
}

function argumentsOf({ name: tool, inputSchema }: ListedTool): readonly Argument[] {
  const { properties = {} } = propertiesOf(inputSchema);
  return Object.entries(properties).map(([name, property]: readonly [string, Readonly<Record<string, unknown>>]) => ({
    where: `${tool}.${name}`,
    name,
    keywords: Object.keys(property).filter((keyword) => keyword !== 'description'),
    description: property['description'],
  }));
}

function sentencesOf(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`])/u).length;
}

function isOutsideTheSentenceBound({ description = '' }: ListedTool): boolean {
  return sentencesOf(description) < 3 || sentencesOf(description) > 8;
}

function descriptionOf(name: string): string {
  return tools.find((tool) => tool.name === name)?.description ?? '';
}

function isAddressedToTheAgent({ description = '' }: ListedTool): boolean {
  return addressedToTheAgent.some((pattern: Readonly<RegExp>) => pattern.test(description));
}

function isUndescribedOrLong({ description }: Argument): boolean {
  return typeof description !== 'string' || description.length >= 300;
}

function hasNoConstraint({ name, keywords }: Argument): boolean {
  return keywords.length === 0 && !anyJsonValue.has(name);
}

describe('the descriptions of the tools of /mcp', () => {
  it('are thirty-one, each under 800 characters, in three to eight sentences', () => {
    expect(tools).toHaveLength(31);
    expect(tools.filter(({ description = '' }) => description.length >= 800).map(({ name }) => name)).toEqual([]);
    expect(tools.filter((tool) => isOutsideTheSentenceBound(tool)).map(({ name }) => name)).toEqual([]);
  });

  it('carry no format, no catalogue of refusals and nothing addressed to the agent but when to use the tool', () => {
    expect(
      tools.filter(({ description = '' }) => /Rejected with|^---$/mu.test(description)).map(({ name }) => name),
    ).toEqual([]);
    expect(tools.filter((tool) => isAddressedToTheAgent(tool)).map(({ name }) => name)).toEqual([]);
  });

  it('name each type of definition with the kind it is in create_definition, at 791 characters in five sentences, and leave its guide to get_guide, which lists every guide', () => {
    const description = descriptionOf('create_definition');

    expect(description).toContain(
      'reasoning, a reasoning function; interaction, an interaction function; computation, a computation function; recall, a recall function; prediction, a prediction function; workflow, a workflow.',
    );
    expect(description).toContain(
      "`source` is the whole document in that type's format, which get_guide gives, and `overview` the Markdown written after it for the person who runs the business.",
    );
    expect([description.length, sentencesOf(description)]).toEqual([791, 5]);
    expect(tools.find(({ name }) => name === 'get_guide')?.inputSchema).toMatchObject({
      properties: { guide: { enum: listingEveryFormat } },
    });
  });

  it('say that a function that calls a tool may change something, in run_definition at 799 characters, and that a reasoning run may be cancelled while one that ends within its call cannot, in cancel_run at 748', () => {
    const [running, cancelling] = [descriptionOf('run_definition'), descriptionOf('cancel_run')];

    expect(running).toContain('A function that calls a tool may change something outside the playbook');
    expect(cancelling).toContain('such as a workflow or a reasoning function');
    expect(cancelling).toContain('or an interaction function that calls a tool, cannot be cancelled.');
    expect([running.length, cancelling.length]).toEqual([799, 748]);
  });
});

describe('the descriptions of the tools that find and connect a provider', () => {
  it('name in search the providers that match a service and no server serves yet, at 454 characters', () => {
    const searching = descriptionOf('search');

    expect(searching).toContain(
      'With `terms` naming a service, `providers` lists those a person may connect that no server serves yet.',
    );
    expect(searching).toHaveLength(454);
  });

  it("open add_connection with a person's account at a service that search lists, claim a service a playbook will use, say an MCP server given by hand says how it authenticates, and end it with what the call does not grant, at 573 characters", () => {
    const adding = descriptionOf('add_connection');

    expect(adding).toMatch(
      /^Starts connecting a person's account at a service, by the name of a provider that search lists, .*\. A service a playbook will use is connected here, whatever connector the agent has of its own for it\. /u,
    );
    expect(adding).toMatch(/ Nothing is granted by this call and no credential passes through it\.$/u);
    expect(adding).toMatch(
      / An MCP server given by hand says how it authenticates, so leave its credential out, and give a kind only where the answer says it names none\. /u,
    );
    expect(adding).toHaveLength(565);
  });
});

describe('the descriptions that say what the instructions leave to them', () => {
  it('name in get_guide the recipes the tools of /mcp can follow', () => {
    expect(descriptionOf('get_guide')).toContain(
      'It holds the recipes first-playbook, remember, give-tools and schedule, which the tools listed here can follow.',
    );
  });

  it('say in each paged tool that its pages are read on only as the person needs', () => {
    expect(
      ['list_runs', 'list_playbook_events', 'list_interactions'].filter(
        (name) =>
          !descriptionOf(name).includes('the next_cursor of the page before, to read on only as the person needs.'),
      ),
    ).toEqual([]);
  });
});

function everyArgument(): readonly Argument[] {
  return tools.flatMap((tool) => argumentsOf(tool));
}

describe('the arguments of the tools of /mcp', () => {
  it('each have a description under 300 characters, the longest the overview of a definition at 235', () => {
    expect(everyArgument().length).toBeGreaterThan(60);
    expect(
      everyArgument()
        .filter((argument) => isUndescribedOrLong(argument))
        .map(({ where }) => where),
    ).toEqual([]);
    expect(Math.max(...everyArgument().map(({ description }) => String(description).length))).toBe(235);
  });

  it('each give their constraints as keywords, but an argument that takes any JSON value', () => {
    expect(
      everyArgument()
        .filter((argument) => hasNoConstraint(argument))
        .map(({ where }) => where),
    ).toEqual([]);
  });
});

type Hints = readonly [boolean, boolean, boolean, boolean];

const served: Readonly<Record<string, Hints>> = {
  create_playbook: [false, false, false, false],
  list_playbooks: [true, false, true, false],
  update_playbook: [false, false, true, false],
  retire_playbook: [false, true, true, false],
  list_models: [true, false, true, true],
  add_connection: [false, false, false, false],
  list_connections: [true, false, true, false],
  reconnect_connection: [false, false, false, false],
  remove_connection: [false, true, true, false],
  list_connection_tools: [true, false, true, true],
  activate_license: [false, false, true, true],
  create_definition: [false, false, false, true],
  list_definitions: [true, false, true, false],
  get_definition: [true, false, true, false],
  update_definition: [false, false, true, true],
  retire_definition: [false, true, true, false],
  run_definition: [false, true, false, true],
  get_run: [true, false, true, false],
  cancel_run: [false, true, true, false],
  list_runs: [true, false, true, false],
  list_playbook_events: [true, false, true, false],
  get_event: [true, false, true, false],
  publish_event: [false, false, false, false],
  search: [true, false, true, true],
  introspect: [true, false, true, true],
  dry_run: [true, false, true, true],
  execute: [false, true, false, true],
  answer_interaction: [false, true, true, false],
  list_interactions: [true, false, true, false],
  send_run_event: [false, false, false, false],
  get_guide: [true, false, true, false],
};

function hintsOf({ annotations = {} }: ListedTool): Hints {
  return [
    annotations['readOnlyHint'] === true,
    annotations['destructiveHint'] === true,
    annotations['idempotentHint'] === true,
    annotations['openWorldHint'] === true,
  ];
}

const apiReadme = readFileSync(new URL('../../../api/README.md', import.meta.url), 'utf8');

const readmeRow = /^\| `([a-z_]+)` +\| (true|false) +\| (true|false) +\| (true|false) +\| (true|false) +\|$/gmu;

function rowOf([, name = '', readOnly, destructive, idempotent, openWorld]: readonly string[]): readonly [
  string,
  Hints,
] {
  return [name, [readOnly === 'true', destructive === 'true', idempotent === 'true', openWorld === 'true']];
}

function reachingOutside(listed: readonly ListedTool[]): readonly string[] {
  return listed.filter(({ annotations }) => annotations?.['openWorldHint'] === true).map(({ name }) => name);
}

describe('the open-world hint of the tools of /mcp', () => {
  it('is set for list_models and run_definition, which reach model providers, for create_definition and update_definition, whose check of a request asks the tool servers what they offer, for the four tools over the tool servers and the one over the tools of a connection, which reach them, for activate_license, which reaches Auto, and for no other tool', () => {
    expect(reachingOutside(tools)).toEqual([
      'list_models',
      'search',
      'list_connection_tools',
      'activate_license',
      'create_definition',
      'update_definition',
      'run_definition',
      'introspect',
      'dry_run',
      'execute',
    ]);
  });
});

describe('the annotations of the tools of /mcp', () => {
  it('say which tools only read, which cannot be undone, which may be repeated and which reach outside', () => {
    expect(Object.fromEntries(tools.map((tool) => [tool.name, hintsOf(tool)]))).toEqual(served);
  });

  it('are those the table of the api README gives', () => {
    expect(Object.fromEntries([...apiReadme.matchAll(readmeRow)].map((row: readonly string[]) => rowOf(row)))).toEqual(
      served,
    );
  });
});
