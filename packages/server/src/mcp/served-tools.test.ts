import { readFileSync } from 'node:fs';

import { type ListedTool, listedTools, type McpSession, withMcpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

let server: ReasoningServer;

let tools: readonly ListedTool[];

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

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
  'prediction-function',
  'computation-function',
  'generation-function',
  'workflow',
];

const listingEveryFormat: unknown = expect.arrayContaining(formatGuides);

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

function hasNoConstraint({ keywords }: Argument): boolean {
  return keywords.length === 0;
}

function everyArgument(): readonly Argument[] {
  return tools.flatMap((tool) => argumentsOf(tool));
}

function titledAgainAsItsAnnotation({ title, annotations }: ListedTool): boolean {
  return title !== undefined && annotations?.['title'] === title;
}

type Hints = readonly [boolean, boolean, boolean, boolean];

const served: Readonly<Record<string, Hints>> = {
  create_playbook: [false, true, false, false],
  list_playbooks: [true, false, true, false],
  get_playbook: [true, false, true, false],
  update_playbook: [false, true, true, false],
  retire_playbook: [false, true, true, false],
  restore_playbook: [false, true, true, false],
  list_models: [true, false, true, true],
  list_generation_models: [true, false, true, false],
  add_connection: [false, true, false, false],
  list_connections: [true, false, true, false],
  reconnect_connection: [false, true, false, false],
  remove_connection: [false, true, true, false],
  list_connection_tools: [true, false, true, true],
  activate_license: [false, true, true, true],
  create_definition: [false, true, false, true],
  list_definitions: [true, false, true, false],
  get_definition: [true, false, true, false],
  update_definition: [false, true, true, true],
  pause_definition: [false, true, true, false],
  resume_definition: [false, true, true, false],
  retire_definition: [false, true, true, false],
  restore_definition: [false, true, true, false],
  run_definition: [false, true, false, true],
  get_run: [true, false, true, false],
  cancel_run: [false, true, true, false],
  list_runs: [true, false, true, false],
  list_playbook_events: [true, false, true, false],
  get_event: [true, false, true, false],
  publish_event: [false, true, false, false],
  get_asset: [true, false, true, false],
  search: [true, false, true, true],
  introspect: [true, false, true, true],
  dry_run: [true, false, true, true],
  query_connection: [true, false, false, true],
  execute_connection: [false, true, false, true],
  answer_interaction: [false, true, true, false],
  list_interactions: [true, false, true, false],
  list_comments: [true, false, true, false],
  resolve_comment: [false, true, true, false],
  send_run_event: [false, true, false, false],
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

type NamedHints = readonly [string, Hints];

function rowOf([, name = '', readOnly, destructive, idempotent, openWorld]: readonly string[]): NamedHints {
  return [name, [readOnly === 'true', destructive === 'true', idempotent === 'true', openWorld === 'true']];
}

function reachingOutside(listed: readonly ListedTool[]): readonly string[] {
  return listed.filter(({ annotations }) => annotations?.['openWorldHint'] === true).map(({ name }) => name);
}

const InputSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const inputOf = Schema.decodeUnknownSync(InputSchema);

const sentencesOfServedToolsWith = (text: string): number => text.split(/(?<=[.!?])\s+(?=[A-Z`])/u).length;

const descriptionOfServedToolsWith = (name: string): string =>
  tools.find((tool) => tool.name === name)?.description ?? '';

const goalsArgumentOf = ({ inputSchema }: ListedTool) => inputOf(inputSchema).properties?.['goals'];

const isOutsideItsBounds = ({ description = '' }: ListedTool): boolean =>
  description.length >= 800 ||
  sentencesOfServedToolsWith(description) < 3 ||
  sentencesOfServedToolsWith(description) > 8;

describe('served tools', () => {
  beforeAll(async () => {
    server = await servingReasoning([]);
    tools = await onMcp(async (session) => listedTools(await session.listTools()));
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('the descriptions of the tools of /mcp', () => {
    it('are forty-one, each under 800 characters, in three to eight sentences', () => {
      expect(tools).toHaveLength(41);
      expect(tools.filter(({ description = '' }) => description.length >= 800).map(({ name }) => name)).toEqual([]);
      expect(tools.filter((tool) => isOutsideTheSentenceBound(tool)).map(({ name }) => name)).toEqual([]);
    });

    it('carry no format, no catalogue of refusals and nothing addressed to the agent but when to use the tool', () => {
      expect(
        tools.filter(({ description = '' }) => /Rejected with|^---$/mu.test(description)).map(({ name }) => name),
      ).toEqual([]);
      expect(tools.filter((tool) => isAddressedToTheAgent(tool)).map(({ name }) => name)).toEqual([]);
    });

    it('leave each format to get_guide, which lists every guide', () => {
      expect(tools.find(({ name }) => name === 'get_guide')?.inputSchema).toMatchObject({
        properties: { guide: { enum: listingEveryFormat } },
      });
    });
  });

  describe('the descriptions of the paged tools', () => {
    it('say in each paged tool that `cursor` is the next_cursor of the page before', () => {
      expect(
        ['list_runs', 'list_playbook_events', 'list_interactions'].filter(
          (name) => !descriptionOf(name).includes('the next_cursor of the page before.'),
        ),
      ).toEqual([]);
    });
  });

  describe('the arguments of the tools of /mcp', () => {
    it('each have a description under 300 characters', () => {
      expect(everyArgument().length).toBeGreaterThan(60);
      expect(
        everyArgument()
          .filter((argument) => isUndescribedOrLong(argument))
          .map(({ where }) => where),
      ).toEqual([]);
    });

    it('each give their constraints as keywords, an argument that takes any JSON value every JSON type', () => {
      expect(
        everyArgument()
          .filter((argument) => hasNoConstraint(argument))
          .map(({ where }) => where),
      ).toEqual([]);
    });
  });

  describe('the titles of the tools of /mcp', () => {
    it('are given again as the title annotation, which the directory listing shows as the name of each tool', () => {
      expect(tools.filter((tool) => !titledAgainAsItsAnnotation(tool)).map(({ name }) => name)).toEqual([]);
    });
  });

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
        'query_connection',
        'execute_connection',
      ]);
    });
  });

  describe('the annotations of the tools of /mcp', () => {
    it('say which tools only read, which cannot be undone, which may be repeated and which reach outside', () => {
      expect(Object.fromEntries(tools.map((tool) => [tool.name, hintsOf(tool)]))).toEqual(served);
    });

    it('are those the table of the api README gives', () => {
      expect(
        Object.fromEntries([...apiReadme.matchAll(readmeRow)].map((row: readonly string[]) => rowOf(row))),
      ).toEqual(served);
    });
  });
});

describe('served tools with goals', () => {
  beforeAll(async () => {
    server = await servingReasoningWithGoals([]);
    tools = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) =>
      listedTools(await session.listTools()),
    );
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('the tools of /mcp on a server that keeps goals', () => {
    it('stay forty-two, each under 800 characters, in three to eight sentences', () => {
      expect(tools).toHaveLength(42);
      expect(tools.filter((tool) => isOutsideItsBounds(tool)).map(({ name }) => name)).toEqual([]);
    });

    it('take the whole list of goals as an optional string of at most 16384 characters in create_playbook and update_playbook, and in no other tool', () => {
      const takers = tools.filter((tool) => goalsArgumentOf(tool) !== undefined);

      expect(takers.map(({ name }) => name)).toEqual(['create_playbook', 'update_playbook']);
      expect(takers.map((tool) => goalsArgumentOf(tool))).toEqual([
        expect.objectContaining({ type: 'string', maxLength: 16_384 }),
        expect.objectContaining({ type: 'string', maxLength: 16_384 }),
      ]);
      expect(takers.map((tool) => String(goalsArgumentOf(tool)?.['description']).length < 300)).toEqual([true, true]);
      expect(takers.map(({ inputSchema }) => inputOf(inputSchema).required?.includes('goals'))).not.toContain(true);
    });

    it('say in create_playbook, update_playbook and get_playbook that they carry goals', () => {
      expect(
        ['create_playbook', 'update_playbook', 'get_playbook'].map((name) =>
          /goals/u.test(descriptionOfServedToolsWith(name)),
        ),
      ).toEqual([true, true, true]);
    });
  });
});
