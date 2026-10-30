import { makeDefinitionOperations } from '@on.auto/definitions';
import { echo } from '@on.auto/definitions/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession, type McpConnection, type McpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { danglingReferencesIn } from '../testing/self-contained.ts';
import { guideToolName, listedTools, operationToolsIn } from '../testing/tool-listing.ts';

const orgOperations = notebookOperations.filter(({ registration }) => registration.scope === 'org');

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [...orgOperations, ...makeDefinitionOperations([echo])] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function endpoint(path: string): McpConnection {
  return { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } };
}

function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', endpoint('/orgs/acme/playbooks/alpha/mcp'), use);
}

const definitionTools = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
];

describe('the tools of each endpoint', () => {
  it('lists the org operations on the org endpoint and no playbook operation', async () => {
    const listing = await withMcpSession('current revision', endpoint('/orgs/acme/mcp'), (session) =>
      session.listTools(),
    );

    expect(listedTools(listing).map(({ name }) => name)).toEqual(['label_playbook', 'list_labels', guideToolName]);
  });

  it('lists the nine definition operations served as tools on a playbook endpoint and no org operation', async () => {
    expect(listedTools(await onAlpha((session) => session.listTools())).map(({ name }) => name)).toEqual([
      ...definitionTools,
      guideToolName,
    ]);
  });

  it('publishes self-contained input schemas with an object root, the type as a plain enum, and no output schema', async () => {
    const tools = listedTools(await onAlpha((session) => session.listTools()));
    const schemas = tools.map(({ inputSchema }) => inputSchema);

    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
    expect(tools.filter(({ outputSchema }) => outputSchema !== undefined)).toEqual([]);
    expect(tools.find(({ name }) => name === 'create_definition')?.inputSchema).toMatchObject({
      properties: { type: { type: 'string', enum: ['echo'] } },
    });
  });
});

const echoRecord = { record: { greeting: 'Hello' } };

describe('the definition tools on a playbook endpoint', () => {
  it('create a definition, execute it and read the run back', async () => {
    const outcome = await onAlpha(async (session) => {
      const created = await session.callTool('create_definition', {
        type: 'echo',
        name: 'greeter',
        source: '{"greeting":"Hello"}',
      });
      const ran = await session.callTool('run_definition', {
        type: 'echo',
        name: 'greeter',
        input: { who: 'Ada' },
      });
      const run = await session.callTool('get_run', {
        run_id: String(ran.structuredContent?.['run_id']),
      });
      return { created, ran, run };
    });

    expect(outcome.created.structuredContent).toMatchObject({ type: 'echo', name: 'greeter', version: 1 });
    expect(outcome.ran.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { greeting: 'Hello', input: { who: 'Ada' } },
    });
    expect(outcome.run.structuredContent).toEqual({ ...outcome.ran.structuredContent, ...echoRecord });
  });

  it('list, read, update and retire a definition', async () => {
    const outcome = await onAlpha(async (session) => {
      await session.callTool('create_definition', { type: 'echo', name: 'welcomer', source: '{"greeting":"Hi"}' });
      const listed = await session.callTool('list_definitions', { type: 'echo' });
      const read = await session.callTool('get_definition', { type: 'echo', name: 'welcomer' });
      const updated = await session.callTool('update_definition', {
        type: 'echo',
        name: 'welcomer',
        source: '{"greeting":"Welcome"}',
      });
      const retired = await session.callTool('retire_definition', { type: 'echo', name: 'welcomer' });
      return { listed, read, updated, retired };
    });

    expect(outcome.listed.structuredContent?.['definitions']).toContainEqual(
      expect.objectContaining({ name: 'welcomer', version: 1 }),
    );
    expect(outcome.read.structuredContent).toMatchObject({ name: 'welcomer', version: 1, status: 'active' });
    expect(outcome.updated.structuredContent).toMatchObject({ name: 'welcomer', version: 2 });
    expect(outcome.retired.structuredContent).toMatchObject({ name: 'welcomer', status: 'retired' });
  });
});

describe('the annotations of a tool', () => {
  it('derive from what the operation declares: read-only for a query, idempotent for a query or a repeatable command, destructive when it cannot be undone, open world only when it reaches outside', async () => {
    const listing = await onAlpha((session) => session.listTools());
    const annotationsByName = Object.fromEntries(
      operationToolsIn(listing).map(({ name, annotations }) => [name, annotations]),
    );

    expect(annotationsByName).toMatchObject({
      create_definition: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
      list_definitions: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
      update_definition: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
      retire_definition: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
      run_definition: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
      cancel_run: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    });
  });
});
