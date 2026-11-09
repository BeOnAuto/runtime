import { readFileSync } from 'node:fs';

import { listedTools, withMcpSession, type ListedTool } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let tools: readonly ListedTool[];

beforeAll(async () => {
  server = await servingReasoning([]);
  tools = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) =>
    listedTools(await session.listTools()),
  );
});

afterAll(async () => {
  await server.stop();
});

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
    expect(Object.fromEntries([...apiReadme.matchAll(readmeRow)].map((row: readonly string[]) => rowOf(row)))).toEqual(
      served,
    );
  });
});
