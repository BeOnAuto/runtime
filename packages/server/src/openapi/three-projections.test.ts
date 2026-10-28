import {
  operationToolsIn,
  operationsIn,
  withMcpSession,
  type DocumentedOperation,
  type ListedTool,
} from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { documentedInputOf, inputOfToolsOf } from '../testing/openapi/documented-inputs.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let documented: readonly DocumentedOperation[];
let tools: Readonly<Record<'org' | 'playbook', readonly ListedTool[]>>;

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, async (session) =>
    operationToolsIn(await session.listTools()),
  );
}

beforeAll(async () => {
  server = await servingReasoning([]);
  const document: unknown = await (await fetch(`${server.origin}/v1/openapi.json`)).json();
  documented = operationsIn(document).filter(({ operation }) => operation.operationId !== 'get_guide');
  tools = { org: await listingOn('/orgs/local/mcp'), playbook: await listingOn('/orgs/local/playbooks/alpha/mcp') };
});

afterAll(async () => {
  await server.stop();
});

const servedOverHttpAlone: ReadonlySet<string> = new Set([
  'get_playbook',
  'get_connection',
  'read_link',
  'approve',
  'give_credential',
  'start',
  'finish',
  'list_providers',
  'upload_dataset',
  'read_build_brief',
  'read_build_rows',
  'upload_candidate',
  'activate_version',
  'get_run_history',
  'get_playbook_analytics',
  'validate',
  'activate_allocation',
  'report_allocation',
  'get_license',
]);

function inPlaybook({ operation }: DocumentedOperation): boolean {
  return operation.parameters.some((parameter) => parameter['$ref'] === '#/components/parameters/playbook');
}

function toolsOf(described: DocumentedOperation): readonly ListedTool[] {
  const name = described.operation.operationId.replace(/_in_org$/u, '');
  return tools[inPlaybook(described) ? 'playbook' : 'org'].filter((tool) => tool.name === name);
}

const servedAsTools = (): readonly DocumentedOperation[] =>
  documented.filter(({ operation }) => !servedOverHttpAlone.has(operation.operationId));

function concretePathOf(path: string): string {
  return `/v1${path
    .replace('{org}', 'local')
    .replace('{playbook}', 'alpha')
    .replaceAll(/\{\w+\}/gu, 'x')}`;
}

function allowedOn(path: string): readonly string[] {
  const methods = documented.filter((described) => described.path === path).map(({ method }) => method.toUpperCase());
  return [...methods, ...(methods.includes('GET') ? ['HEAD'] : [])].toSorted();
}

describe('the operations of the document and the tools of the endpoints', () => {
  it('are one tool per operation served as one, of the same description, on the endpoint of its scope', () => {
    expect(servedAsTools().map((described) => toolsOf(described).map(({ description }) => description))).toEqual(
      servedAsTools().map(({ operation }) => [operation.description]),
    );
    expect(servedAsTools()).toHaveLength(31);
  });

  it('leave no tool of an endpoint without its operation, and give none to an operation served over HTTP alone', () => {
    const named = servedAsTools().flatMap((described) => toolsOf(described));

    expect(named).toHaveLength(tools.org.length + tools.playbook.length);
    expect(documented.filter(({ operation }) => servedOverHttpAlone.has(operation.operationId))).toHaveLength(19);
    expect([...tools.org, ...tools.playbook].filter(({ name }) => servedOverHttpAlone.has(name))).toEqual([]);
  });
});

describe('the paths of the document', () => {
  it('are each a route of the server, which names the very methods the document gives it', async () => {
    const paths = [...new Set(documented.map(({ path }) => path))];
    const allowed = await Promise.all(
      paths.map(async (path) => {
        const answer = await fetch(`${server.origin}${concretePathOf(path)}`, { method: 'PATCH' });
        return [answer.status, answer.headers.get('allow')];
      }),
    );

    expect(allowed).toEqual(paths.map((path) => [405, allowedOn(path).join(', ')]));
  });
});

describe('the input an operation documents', () => {
  it("is its tool's input without the fields its path gives, in the query of a GET or a DELETE and the body of a POST", () => {
    expect(servedAsTools().map((described) => [documentedInputOf(described)])).toEqual(
      servedAsTools().map((described) => inputOfToolsOf(described, toolsOf(described))),
    );
  });
});
